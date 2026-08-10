# Status Sharding 2 Usage and Operations Guide

## What runs where

`ClusterManager` runs once in the parent process and owns topology, child creation, IPC routing, lifecycle state, heartbeats, and recovery.

`Cluster` is one managed runtime with one or more Discord shard IDs; it is the only public owner of spawn, kill, respawn, and recovery for that runtime.

`ShardingClient` and `ShardingCoreClient` run inside a cluster; each exposes `client.cluster` for child-to-manager IPC, manager operations, evaluations, and readiness events.

Choose `mode: 'process'` when you want process isolation and independent memory, or choose `mode: 'worker'` when shared-process deployment and worker-thread startup suit your application.

## Project layout

Keep the manager entry point separate from the cluster entry point because the manager launches the cluster file once for every cluster.

```text
src/manager.ts
src/cluster.ts
```

Build both files before starting the manager, and always give `ClusterManager` the built cluster file path rather than a TypeScript source file.

## Manager setup

```ts
import { ClusterManager } from 'status-sharding';

const manager = new ClusterManager('./dist/cluster.js', { mode: 'process', token: process.env.DISCORD_TOKEN, totalShards: 6, totalClusters: 3, shardsPerClusters: 2, respawn: true, heartbeat: { enabled: true, interval: 5_000, timeout: 15_000, maxMissedHeartbeats: 3, maxRestarts: 10 }, spawnOptions: { delay: 8_000, timeout: 120_000 }, advanced: { queueUntilReady: true } });

manager.on('debug', (message) => console.debug(message));
manager.on('clusterLifecycle', (cluster, record) => console.info('cluster lifecycle', cluster.id, record));
manager.on('clusterError', (cluster, error) => console.error('cluster error', cluster.id, error));

await manager.spawn();
```

Set `totalShards: -1` only when the manager has a token and may call Discord’s gateway metadata endpoint; otherwise provide an explicit positive shard count.

Set `totalClusters` to the number of runtimes you want and `shardsPerClusters` to the maximum shard group size; v2 normalizes the topology so every global shard ID is owned exactly once.

Use `clusterData` only for small primitive environment values that every child needs, and use `clusterOptions` only for supported fork or worker options.

Use `advanced.queueUntilReady: true` when startup code can send IPC before the Discord client is ready; queued operations run in order after readiness and emit `debug` messages when queued, released, or rejected.

## Discord.js cluster client

```ts
import { GatewayIntentBits } from 'discord.js';
import { ShardingClient } from 'status-sharding';

const client = new ShardingClient({ intents: [GatewayIntentBits.Guilds] });

client.cluster.on('managerReady', () => console.info('every cluster is ready'));
client.once('clientReady', () => console.info('this Discord.js cluster is ready'));

await client.login(process.env.DISCORD_TOKEN);
```

`ShardingClient` receives only its assigned shard IDs and uses Discord.js shard events to report healthy and unhealthy Gateway state to `client.cluster`.

## @discordjs/core cluster client

```ts
import { GatewayIntentBits } from '@discordjs/core';
import { ShardingCoreClient } from 'status-sharding/core';

const client = new ShardingCoreClient({ token: process.env.DISCORD_TOKEN ?? '', gateway: { intents: GatewayIntentBits.Guilds }, rest: { version: '10' } });

client.cluster.on('managerReady', () => console.info('every cluster is ready'));
await client.gateway.connect();
```

`ShardingCoreClient` creates a typed `REST` client and typed `WebSocketManager`, assigns only the current cluster’s shard IDs, and becomes ready only after every assigned core shard dispatches `READY`.

Use `client.gateway` for WebSocket manager methods such as `connect()`, `destroy()`, `fetchStatus()`, and `getShardIds()`, and use `client.rest` for authenticated REST API calls.

Core clients do not expose a Discord.js guild cache, so `evalOnGuild` intentionally rejects for them; route guild-specific work through Discord.js or your own core event state instead.

## Readiness and events

Use `clusterCreate` to attach per-cluster listeners before a runtime starts, `clusterReady` when one runtime is ready, and `ready` only when every managed cluster is ready.

Use `clusterLifecycle` as the canonical operational stream because every record includes a cluster ID, generation, previous state, current state, reason, timestamps, and exit details.

Use `clusterRestart` to observe an automatic recovery attempt, then wait for `clusterReady`; do not create a competing respawn from this event.

Use `clusterDeath` to raise an alert for a failed generation, but expect automatic recovery when `respawn: true` and the restart budget allows it.

Use `clusterError` for failures that require attention, including failed spawn, IPC errors, exhausted restart budget, and unverified process termination.

Use `debug` for complete sentence-based package diagnostics; Status Sharding never writes these messages to stdout itself.

Inside a child, use `client.cluster.on('ready')` for that child’s transport readiness, `managerReady` for full-topology readiness, `unready` for lost manager IPC, and `message` for custom manager messages.

## Custom IPC

Use `send()` for one-way data, `broadcast()` for one-way fan-out, and `request()` when the sender needs a reply.

```ts
manager.on('clientRequest', (message) => { if (message.data === 'health') void message.reply({ ok: true }); });

const reply = await client.cluster.request('health');
await client.cluster.broadcast({ type: 'configuration-updated' });
```

`ProcessMessage.reply()` is valid only for a request with a nonce, and every request is generation-scoped so an old runtime cannot resolve a new runtime’s request.

Send only JSON-like values through IPC: strings, numbers, booleans, `null`, `undefined`, arrays, and plain objects containing the same values.

## Broker channels

The broker is a dedicated channel transport and is separate from normal `message` and `clientRequest` IPC and from evaluation traffic.

```ts
manager.broker.listen('configuration-invalidated', (data) => reloadConfiguration(data));
client.cluster.broker.listen('configuration-invalidated', (data) => reloadConfiguration(data));

await manager.broker.send('configuration-invalidated', { revision: 42 });
await manager.broker.send('configuration-invalidated', { revision: 42 }, 2);
await client.cluster.broker.send('configuration-invalidated', { revision: 42 });
```

`manager.broker.send()` delivers from the manager to all children or one selected cluster and does not call manager listeners; `client.cluster.broker.send()` delivers from one child to manager listeners and does not fan out to other children. A broker listener failure emits a sentence through `debug` and does not break IPC routing.

## Evaluating code

Use `manager.eval()` for manager-local code, `manager.evalOnCluster()` for a cluster object, `manager.evalOnClusterClient()` for one child client, and `manager.broadcastEval()` for selected child clients.

```ts
const sizes = await manager.broadcastEval((client) => client.guilds.cache.size);
const selected = await manager.broadcastEval((client) => client.cluster.id, { shard: [0, 4], useAllSettled: true });
const guildId = await manager.evalOnGuild('790154679308124180', (_client, _context, guild) => guild?.id ?? null);
```

Use `cluster.evalOnClient()` for a direct request to that cluster’s client and `client.cluster.evalOnManager()` or `client.cluster.broadcastEval()` when child code must request manager-side work.

Do not evaluate user-provided scripts because evaluation executes code in the target runtime; always return a JSON-like result.

## Heartbeats and recovery

Heartbeats probe the manager-to-child IPC path and process/worker liveness; `client.cluster.getShardHealth()` reports the child’s Discord Gateway status for its assigned shards.

When a heartbeat times out, the cluster enters `degraded`, emits lifecycle/debug events, and requests recovery when `respawn: true`; configured restart limits and backoff prevent endless restart loops.

Do not manually respawn from `clusterDeath` or `clusterRestart` because automatic recovery may already own the lifecycle operation.

Call `await cluster.respawn()` for a deliberate single-cluster restart, `await manager.respawnClusters([ids])` for selected clusters, and `await manager.respawnAll()` for a controlled fleet restart.

If you receive `CLUSTERING_TERMINATION_UNVERIFIED`, do not start another replacement; the old runtime may still own Discord Gateway sessions, so inspect the host/container and restart it only after the stuck process is gone.

## Manual spawn queue

Set `queueOptions: { mode: 'manual' }` when an external deployment system must control cluster order.

Call `await manager.spawn()` to start the first cluster, then call `await manager.spawnNextCluster()` for each next cluster, or call `await client.cluster.spawnNextCluster()` from a ready child.

Use `resetSpawnQueue()` only when intentionally restarting manual progression; it does not create a duplicate runtime when the selected cluster is already alive.

## Re-clustering and shutdown

Call `await manager.reCluster.start({ totalShards, totalClusters, shardsPerClusters })` only for a topology change and wait for `ready` again before issuing normal manager operations.

V2 stops and verifies the old topology before creating the new topology, preventing overlapping Gateway sessions at the cost of a controlled availability gap.

```ts
process.once('SIGINT', () => void manager.shutdown());
process.once('SIGTERM', () => void manager.shutdown());
```

Always await or return the `shutdown()` promise from deployment hooks so pending IPC is rejected predictably and every child or worker receives a verified stop request.
