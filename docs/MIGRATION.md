# Complete v1 to v2 migration reference

This document compares the published `status-sharding` v1.9.11 source with v2. It is an API and behavior inventory, not only a list of breaking compiler errors. Read [USAGE.md](./USAGE.md) for complete deployment and operational examples.

## Upgrade checklist

- Upgrade every parent and child to the same v2 release; v1 and v2 do not share the same IPC protocol, lifecycle model, or generated environment metadata.
- Upgrade the runtime to Node.js 20 or newer; v1 supported Node.js 18.4 or newer.
- Reinstall the package and rebuild the application. v2 is a real dual package: `import` loads ESM output and `require` loads CommonJS output with matching declarations.
- Replace direct mutation of cluster state or direct child-process control with the documented manager and cluster lifecycle methods.
- Audit every `clusterDeath` listener before deploying. It must alert and observe recovery, not start a competing respawn.
- Audit custom IPC, broker payloads, eval results, contexts, and `clusterData` so they contain only JSON-like data.

## Kept compatible

- The package names and public entry points remain `status-sharding` and `status-sharding/core`; `ClusterManager`, `Cluster`, `ClusterClient`, `ShardingClient`, `ShardingCoreClient`, heartbeat, recluster, queue, message, child, worker, utility, and type exports remain available.
- The normal manager and client entry points remain `spawn`, `broadcast`, `request`, `broadcastEval`, `eval`, `evalOnCluster`, `evalOnClusterClient`, `evalOnGuild`, `respawnAll`, `respawnClusters`, `spawnNextCluster`, `triggerReady`, `cluster.kill`, and `cluster.respawn`.
- `mode: 'process' | 'worker'`, `totalShards`, `totalClusters`, `shardsPerClusters`, `shardArgs`, `execArgv`, `respawn`, `heartbeat`, `spawnOptions`, `queueOptions`, `clusterData`, `clusterOptions`, and `advanced.logMessagesInDebug` remain configuration concepts.
- `ReClusterManager.start()` still accepts `totalShards`, `totalClusters`, `shardsPerClusters`, and `restartMode`; both `'rolling'` and `'gracefulSwitch'` values remain accepted.
- Standard one-way IPC still uses `send()` and `broadcast()`, request/reply IPC still uses `request()` and `ProcessMessage.reply()`, and evaluated code still runs in the requested manager, cluster, or client runtime.

## Removed configuration and behavior

| v1 item | v2 replacement or action |
| --- | --- |
| `respondToHeartbeatWhenNotReady` | Remove it. A child always acknowledges a valid transport heartbeat; the acknowledgement includes its current Gateway health instead of suppressing the acknowledgement. |
| `ClusterClientData.RespondToHeartbeatWhenNotReady` | Remove reads of this child metadata field. Use `client.cluster.getShardHealth()` when application code needs Gateway health. |
| `advanced.proceedBroadcastIfClusterDead` | Remove it. A broadcast to an unavailable target rejects rather than quietly omitting that target. Use `useAllSettled` only for `broadcastEval` when partial evaluation results are explicitly acceptable. |
| Manager option `shardList` | Remove it. v2 computes a complete, contiguous topology from `totalShards`, `totalClusters`, and `shardsPerClusters`; every shard is assigned exactly once. |
| Manager option `clusterList` | Remove it. v2 creates sequential cluster IDs for the computed topology. |
| Arbitrary `clusterData: object` | Pass only `Record<string, string | number | boolean>`. It becomes child environment metadata and cannot safely carry nested runtime objects. |
| `spawnOptions.timeout: -1` meaning no deadline | Do not use it. v2 converts `-1` to the bounded default of `120000` milliseconds so a non-ready runtime cannot block lifecycle work forever. |
| `restartMode` overlap semantics | Do not rely on v1's overlapping old/new Gateway sessions. v2 stops and verifies the old topology before starting the replacement, regardless of the accepted compatibility label. |
| `net-ipc` runtime dependency | It is removed. v2 uses the native child-process or worker IPC transport and validates its payloads. |

## Changed configuration

| Area | v1 | v2 |
| --- | --- | --- |
| Node runtime | `>=18.4.0` | `>=20.0.0` |
| Module output | one CommonJS-style `dist/*.js` output was used for both import styles | native ESM `dist/*.js` and CommonJS `dist/*.cjs`, each with its own declaration file |
| Peer minimums | `discord.js >=14.27.0`, `@discordjs/core/rest/ws >=2.6.x` | `discord.js >=14.14.1`, `@discordjs/core >=2.2.1`, `@discordjs/rest >=2.6.0`, `@discordjs/ws >=2.0.3` |
| Heartbeat recovery | interval, timeout, missed-beat count, and restart count | adds `restartWindow`, `restartBackoff`, and `maxRestartBackoff` to constrain repeated recovery attempts |
| Advanced IPC | debug-message switch and optional dead-target omission | `ipcTimeout`, `ipcMaxPayload`, `terminationTimeout`, `forceKillAfter`, `queueUntilReady`, and `logMessagesInDebug` |
| Startup before child readiness | child IPC methods immediately rejected | set `advanced.queueUntilReady: true` to queue supported child operations in order, with `debug` events at queue, run, and failure time |
| Queue metadata | `ClusterQueueMode` could be absent | child metadata always includes `ClusterQueueMode`, `QueueUntilReady`, `IpcTimeout`, `IpcMaxPending`, and `IpcMaxPayload` |

## Removed or changed return contracts

| API | v1 return | v2 return and required migration |
| --- | --- | --- |
| `manager.spawn()` | `Promise<Queue>` | `Promise<void>`; await startup and use `manager.clusterQueue` only when controlling the queue deliberately. |
| `manager.respawnAll()` | `Promise<Map<number, Cluster>>` | `Promise<void>`; read `manager.clusters` after the awaited lifecycle operation instead of using a return map. |
| `manager.respawnClusters()` | `Promise<Map<number, Cluster>>` | `Promise<void>`; read the current clusters after it resolves. |
| `client.cluster.triggerReady()` | `boolean` | `Promise<boolean>`; always `await` it before assuming the manager received child readiness. |
| `Queue.start()` | `Promise<Queue>` | `Promise<void>`; no fluent queue return exists. |
| `Queue.next()` | `Promise<unknown>` | `Promise<void>`; queued work resolves through the promise returned from `Queue.add()`. |
| `Queue.resume()` | `Queue` | `Promise<void>`; await it when restart ordering matters. |
| `Queue.stop()` | `Queue` | `void`; it now rejects the active and waiting work instead of merely pausing it. |
| `cluster.ready`, `cluster.exited`, `cluster.respawning`, `cluster.thread`, `cluster.lastHeartbeatReceived` | public mutable fields in practice | read-only lifecycle observations. Use `spawn`, `kill`, `respawn`, `recover`, or manager APIs to change state. |

## Added public APIs and observability

| v2 item | What it adds |
| --- | --- |
| `manager.shutdown()` | A single awaited shutdown path that stops heartbeats and queue work, rejects pending IPC, terminates all runtimes, and emits `shutdown`. |
| `manager.clusterQueue` | The managed startup queue is available for inspection or advanced manual startup coordination. |
| `manager.resetSpawnQueue()` | Resets manual queue progress before a new manual startup sequence. |
| `cluster.lifecycleState` | Read-only state: `stopped`, `starting`, `ready`, `degraded`, `stopping`, or `failed`. |
| `cluster.generationNumber` | Read-only generation counter for correlating restarts and preventing stale IPC replies. |
| `cluster.recover(reason)` | The recovery primitive used by automatic recovery. Application code normally observes it through events rather than calling it directly. |
| `client.cluster.getShardHealth()` | Returns each assigned shard's ID, readiness, and available Gateway status. |
| `client.cluster` `unready` event | Signals parent IPC closure so child-local services can stop dependent work. |
| `HeartbeatManager.reset(cluster)` | Clears pending heartbeat state and counters for a new cluster generation. |
| `HeartbeatManager.getHealthSummary()` | Returns per-cluster heartbeat/restart counters and health classification. |
| `ClusterLifecycleRecord` | Structured lifecycle data with cluster ID, generation, desired state, previous/current state, reason, timestamp, exit data, restart attempt, and optional error. |
| Dedicated broker wire type | `MessageTypes.BrokerMessage` isolates broker channel traffic from custom messages, request replies, and eval routing. |

## Lifecycle, termination, and recovery

- `cluster.spawn()`, `cluster.kill()`, and `cluster.respawn()` are serialized so concurrent callers observe one lifecycle operation rather than overlapping kills and spawns.
- A kill first requests the normal stop, then escalates to a forceful stop after `advanced.forceKillAfter`, and waits no longer than `advanced.terminationTimeout` for exit confirmation.
- If the runtime cannot be confirmed gone, v2 emits `clusterError` with `CLUSTERING_TERMINATION_UNVERIFIED` and refuses to treat a replacement as safe. Do not call `respawn()` again from that error; inspect the host/container and remove the stuck runtime before restart.
- Recovery is budgeted and backed off. With `respawn: true`, a process exit or heartbeat failure can schedule a recovery; when its restart budget is exhausted, v2 emits the lifecycle/error information instead of repeatedly creating Gateway sessions.
- Add `await manager.shutdown()` to `SIGINT`, `SIGTERM`, container hooks, and test cleanup. It stops heartbeats, rejects outstanding IPC promises, cancels queue work, terminates clusters, and emits `shutdown` after completion.
- `cluster.respawn()` remains the explicit manual action for an operator-confirmed fault. Use it when automatic recovery is disabled, has exhausted its budget, or after the stuck runtime has actually been removed; otherwise observe the automatic recovery flow.

## Events: what to listen for

| Event | v1 | v2 use |
| --- | --- | --- |
| `clusterCreate` | available | unchanged; a topology object was created, not that Discord is ready. |
| `clusterReady` | available | unchanged; one cluster reached client readiness. |
| `ready` on manager | available | unchanged; every currently expected cluster is ready. |
| `message` and `clientRequest` | available | unchanged for normal custom IPC only. Broker traffic is deliberately separate and does not emit these events. |
| `debug` | available | unchanged; v2 emits complete sentence diagnostics for lifecycle actions, heartbeat probes, queued work, broker listener failures, and transport errors. The package does not write them to stdout. |
| `clusterDeath` | absent on manager | new manager event for a failed generation, with its `ClusterLifecycleRecord`; use it for alerting. |
| `clusterLifecycle` | absent | new manager event for every state transition; use it for state tracking and audit logs. |
| `clusterRestart` | absent | new manager event before an automatic recovery attempt; observe it rather than calling a competing respawn. |
| `clusterError` | absent on manager | new manager event for operator-visible failures such as spawn failure, IPC failure, termination verification failure, and exhausted recovery. |
| `shutdown` | absent | new manager event after `manager.shutdown()` completes. |
| `restart`, `lifecycle`, `degraded`, `manager` on `Cluster` | absent | new cluster-level lifecycle visibility. `degraded` marks a health problem before recovery. |
| `unready` on `ClusterClient` | absent | new child event when manager IPC closes; use it to stop child-local work that needs the parent. |
| `managerReady` on `ClusterClient` | available | unchanged; all manager clusters are ready, distinct from that child client's own `ready`. |

## Heartbeats and Gateway health

- v1 could hide an acknowledgement while the Discord client was not ready. That made an alive but still-connecting child indistinguishable from a broken IPC runtime and could provoke needless restarts.
- v2 always answers a valid heartbeat transport request. The response carries `ready: false` until the assigned Discord Gateway shards are healthy, allowing the parent to distinguish communication from Gateway state.
- For Discord.js, readiness comes from the client readiness state. For `ShardingCoreClient`, every assigned `WebSocketManager` shard must have status `3` (`Ready`) before the client reports healthy.
- Use `client.cluster.getShardHealth()` for per-shard `{ id, ready, status }` information. Use `manager.heartbeat.getHealthSummary()` for parent-side heartbeat and restart counters.
- A missed heartbeat moves the cluster into a degraded lifecycle state only after the configured threshold; it does not blindly create an unlimited respawn loop.

## IPC and serialization

- v2 accepts only JSON-like wire values: strings, numbers, booleans, `null`, `undefined`, arrays, and plain objects containing the same kinds of values. Do not send class instances, maps, sets, functions, symbols, bigints, circular data, or non-serializable eval results.
- IPC requests are bounded by `advanced.ipcTimeout`, checked against `advanced.ipcMaxPayload`, and scoped to a cluster generation. A reply from an old process cannot resolve a request belonging to its replacement.
- `send()` and `broadcast()` are one-way operations. `request()` creates a request nonce and requires `ProcessMessage.reply()` in the recipient. Pending work rejects predictably when IPC closes, a target exits, or shutdown starts.
- `broadcastEval()` supports `cluster`, `shard`, `guildId`, `context`, `timeout`, and `useAllSettled`. `guildId` cannot be combined with `cluster` or `shard`; use `useAllSettled` only when callers can explicitly process rejected target results.
- `evalOnGuild()` now reliably routes to the cluster that owns the guild shard and supplies the cached Discord.js guild as the third callback argument. It intentionally rejects for `ShardingCoreClient`, which has no guild cache.
- Eval scripts are executable code, not a sandbox. Never pass user-controlled script text to an eval API.

## IPC broker

- The broker is a dedicated envelope (`MessageTypes.BrokerMessage`), separate from normal `message`/`clientRequest` traffic and separate from eval request routing. A broker payload cannot be interpreted as a normal custom message or eval response.
- `manager.broker.listen(channel, callback)` registers a manager-side channel listener. `await manager.broker.send(channel, data)` delivers only to child listeners; `await manager.broker.send(channel, data, clusterId)` delivers to exactly one child. It does not invoke the manager's own listener.
- `client.cluster.broker.listen(channel, callback)` registers a child listener. `await client.cluster.broker.send(channel, data)` delivers only to the manager listener. It does not fan out to sibling clusters.
- This routing direction matches v1's broker contract. `listen()` returns `void`, and callback payloads must satisfy v2's JSON-like `Serializable` type.
- A throwing broker listener is isolated from transport handling and is reported through the relevant `debug` event. A missing target cluster makes a manager broker send reject with `BROKER_INVALID_CLUSTER_ID`.

## Core client changes

- `ShardingCoreClient` remains available through both `status-sharding` and `status-sharding/core`; the `status-sharding/core` entry now exports the core classes rather than re-exporting the entire main entry.
- Core package peers are loaded only when a `ShardingCoreClient` is constructed. A Discord.js-only deployment does not need to install the core peers.
- `ShardingCoreClient.gateway` is a typed `WebSocketManager` and `ShardingCoreClient.rest` is a typed `REST`. Construct it, register any dispatch handlers, then call `await client.gateway.connect()`.
- Core readiness waits for each assigned shard to reach Gateway `Ready`, not merely for the first ready dispatch, and core `evalOnGuild()` remains unsupported by design.

## Reclustering

- `await manager.reCluster.start(options)` returns `true` when it performs a topology replacement and `false` if another recluster is already active.
- v2 validates the requested positive topology, marks the manager unready, stops and verifies all old clusters, replaces the cluster map, then runs the normal spawn path.
- Do not use v1 assumptions that `gracefulSwitch` or `rolling` keep old and new shard sessions alive together. This removal is intentional to prevent duplicate or drained Discord Gateway sessions.

## Minimal before-and-after changes

```ts
// v1
manager.on('clusterCreate', (cluster) => cluster.on('death', () => void cluster.respawn()));
const queue = await manager.spawn();
client.cluster.triggerReady();
manager.broker.listen('invalidate', onInvalidate);
```

```ts
// v2
manager.on('clusterDeath', (cluster, record) => alert(cluster.id, record.reason));
manager.on('clusterRestart', (cluster, record) => audit(cluster.id, record.restartAttempt));
manager.on('clusterError', (_cluster, error) => alertError(error));
await manager.spawn();
await client.cluster.triggerReady();
manager.broker.listen('invalidate', onInvalidate);
```

Use `clusterLifecycle`, `clusterRestart`, `clusterReady`, and `clusterError` to observe v2 recovery. Only manually call `cluster.respawn()` after deciding that automatic recovery is not already responsible and that any old runtime is actually gone.
