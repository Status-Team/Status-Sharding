# Status Sharding 2

Status Sharding is a process/worker cluster manager for Discord bots. It keeps
shard ownership deterministic, gives every cluster a generation-scoped IPC
channel, and recovers failed runtimes without spawning a replacement beside a
live one.

## Highlights

- Process (`child_process.fork`) and worker-thread runtimes.
- Discord.js and `@discordjs/core` child clients.
- Automatic shard/cluster topology calculation.
- Serialized spawn, kill, and respawn operations.
- Heartbeats that observe ready clusters without restarting a cluster during
  gateway startup or shutdown.
- SIGTERM-then-SIGKILL termination with verification and a hard deadline.
- Generation-scoped IPC requests so replies from an old process cannot resolve
  a new process's request.
- ESM and CommonJS package entry points.

## Requirements

- Node.js 20 or newer.
- `discord.js` for `ShardingClient` (a peer dependency).
- `@discordjs/core`, `@discordjs/rest`, and `@discordjs/ws` when using
  `ShardingCoreClient` (optional peer dependencies).

## Install

```bash
pnpm add status-sharding discord.js
```

The package provides both module formats:

```ts
import { ClusterManager } from 'status-sharding';
```

```js
const { ClusterManager } = require('status-sharding');
```

## Documentation

Read [the usage and operations guide](./docs/USAGE.md) for manager setup, child clients, IPC, evaluation, heartbeat recovery, manual queues, re-clustering, and shutdown.

Read [the v1 migration guide](./docs/MIGRATION.md) before upgrading an existing deployment.

## Cluster manager

The manager launches the file once per cluster. Shard IDs are passed through
the environment and command-line arguments. Keep the token in an environment
variable rather than in source control.

```ts
import { ClusterManager } from 'status-sharding';

const manager = new ClusterManager('./dist/cluster.js', {
  mode: 'process', // or 'worker'
  token: process.env.DISCORD_TOKEN,
  totalShards: 6,
  totalClusters: 3,
  shardsPerClusters: 2,
  respawn: true,
  heartbeat: {
    enabled: true,
    interval: 5_000,
    timeout: 15_000,
    maxMissedHeartbeats: 3,
    maxRestarts: 10,
  },
  spawnOptions: {
    delay: 8_000,
    timeout: 120_000,
  },
  advanced: {
    queueUntilReady: true,
  },
});

manager.on('clusterReady', (cluster) => {
  console.log(`cluster ${cluster.id} ready: ${cluster.shardList.join(',')}`);
});

manager.on('clusterDeath', (cluster, record) => {
  console.error('cluster lifecycle failure', cluster.id, record);
});

manager.on('clusterError', (cluster, error) => {
  console.error(`cluster ${cluster.id} error`, error);
});

manager.on('debug', (message) => console.debug(message));

await manager.spawn();
```

When using a custom cluster class, override the protected factory so the
runtime instance matches the manager's `InternalCluster` type:

```ts
class BotManager extends ClusterManager<BotClient, BotCluster> {
	protected createClusterInstance(id: number, shards: readonly number[]): BotCluster {
		return new BotCluster(this, id, [...shards]);
	}
}
```

Debug messages are emitted through the manager and cluster `debug` events only;
the package never writes debug output directly. Multiple concurrent termination
requests share one tracked termination operation, so a second request cannot
start a competing kill sequence for the same runtime.

Set `advanced.queueUntilReady` to `true` when child-side operations may be
called before the Discord client becomes ready. Those operations wait in order,
emit debug messages when queued and released, and reject with a debug message
if the operation fails or the IPC channel closes. The default is `false`, which
preserves the immediate `CLUSTERING_NOT_READY` rejection.

When `totalShards` is `-1` (the default), a token is required so the manager
can query Discord's gateway metadata. Set the counts explicitly in tests or
when the gateway metadata is managed elsewhere.

## Discord.js child

Each process receives only its assigned shards. The cluster client reports
ready after the Discord.js client is ready. Heartbeat acknowledgements always
confirm IPC/process liveness; gateway readiness is tracked separately.

```ts
import { GatewayIntentBits } from 'discord.js';
import { ShardingClient } from 'status-sharding';

const client = new ShardingClient({
  intents: [GatewayIntentBits.Guilds],
});

client.once('clientReady', () => {
  console.log(`cluster ${client.cluster.id} ready`);
});

await client.login(process.env.DISCORD_TOKEN);
```

## `@discordjs/core` child

Install the core packages and import the core client from the `./core`
subpath:

```ts
import { GatewayIntentBits } from '@discordjs/core';
import { ShardingCoreClient } from 'status-sharding/core';

const client = new ShardingCoreClient({
  token: process.env.DISCORD_TOKEN ?? '',
  gateway: {
    intents: GatewayIntentBits.Guilds,
  },
  rest: { version: '10' },
});

await client.gateway.connect();
```

## Lifecycle safety

There is one lifecycle owner per cluster. A runtime is not replaced until its
old process or worker is confirmed dead. On an unexpected process exit:

1. One `death` event is emitted for the affected generation.
2. Pending IPC requests for that generation are rejected.
3. The runtime is terminated, escalating from SIGTERM to SIGKILL.
4. Recovery waits for the configured backoff and starts a new generation only
   after termination is verified.

If the runtime remains alive after both signals and the hard deadline, the
manager emits `clusterError`, emits a `termination-unverified` lifecycle record,
raises a `CLUSTERING_TERMINATION_UNVERIFIED` process warning, and suppresses
automatic respawn. On Linux, debug output includes the `/proc` state; `D`
means the process is blocked in uninterruptible kernel I/O and cannot be fixed
from JavaScript.

Heartbeat probes skip clusters in `starting` and `stopping` states. This is
intentional: Discord gateway startup can take longer than one heartbeat
interval and must not be mistaken for a crashed process. Restart limits are
enforced inside the configured restart window.

Always shut down a manager during process termination:

```ts
process.once('SIGTERM', () => void manager.shutdown());
process.once('SIGINT', () => void manager.shutdown());
```

## Evaluation and IPC

The manager and cluster clients expose `broadcastEval`, `evalOnClusterClient`,
`evalOnCluster`, and `evalOnGuild`. Requests have bounded timeouts, payload
limits, and generation-aware nonces. Do not use evaluation for untrusted input;
it executes code in the target runtime.

## Development

```bash
pnpm install
pnpm run check
pnpm run test
pnpm run docs
```

`pnpm run test` type-checks and builds ESM (`.js`) and CommonJS (`.cjs`)
outputs together in `dist/`. Documentation is generated outside the repository in
`/tmp/status-sharding-docs`; the GitHub Actions Pages workflow publishes it
without committing a `docs/` directory.

Live API documentation: <https://status-team.github.io/Status-Sharding/>.

## License

GPL-3.0. See [LICENSE](./LICENSE).
