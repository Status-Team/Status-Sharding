# Migrating from 1.x to 2.0

## Required runtime and build changes

- Upgrade to Node.js 20 or newer, run `pnpm install`, and build with `pnpm run build` before starting the manager.
- Published output changed to dual format: ESM uses `dist/*.js`, CommonJS uses `dist/*.cjs`, and both formats have matching declaration files.
- Run every manager and cluster from the same 2.0 version; do not mix a 1.x manager with 2.0 children.

## Removed options and behavior

- Remove `respondToHeartbeatWhenNotReady`; v2 always acknowledges transport heartbeats and reports Discord Gateway readiness separately.
- Remove `advanced.proceedBroadcastIfClusterDead`; broadcasts now surface unavailable-target failures instead of silently proceeding.
- Remove manager `shardList` and `clusterList` configuration; specify `totalShards`, `totalClusters`, and `shardsPerClusters` instead.
- Treat `clusterData` as environment data only: use strings, numbers, and booleans rather than arbitrary objects.
- Do not rely on broad implicit serialization of classes, maps, sets, functions, symbols, or bigints; IPC and eval results must be JSON-like values.
- `restartMode: 'rolling'` and `restartMode: 'gracefulSwitch'` remain accepted for compatibility, but v2 safely stops the old topology before starting the new one to prevent overlapping Gateway sessions.

## Lifecycle API changes

- Await `manager.spawn()`, `manager.respawnAll()`, `manager.respawnClusters()`, `cluster.spawn()`, `cluster.kill()`, and `cluster.respawn()`; lifecycle work is serialized and promise-based.
- `cluster.ready`, `cluster.exited`, `cluster.respawning`, `cluster.thread`, and `cluster.lastHeartbeatReceived` are now read-only state; change a cluster only through its lifecycle methods.
- Replace direct child/process management with `cluster.kill()` or `cluster.respawn()` so termination is verified before replacement.
- Add `await manager.shutdown()` to SIGINT and SIGTERM handling; v2 rejects pending IPC and stops every cluster before resolving shutdown.

## New events and recovery flow

- Add `clusterLifecycle` for every state transition, `clusterRestart` for automatic recovery, `clusterDeath` for a failed generation, `clusterError` for operator-visible failures, and `shutdown` for completed manager shutdown.
- Keep `clusterReady` for one available cluster and `ready` for the whole topology; use `managerReady` inside children for whole-manager initialization.
- Replace immediate respawn logic in `clusterDeath` listeners with observation of `clusterRestart`, `clusterReady`, and `clusterError`; v2 may already be recovering the runtime.
- If `clusterError` reports `CLUSTERING_TERMINATION_UNVERIFIED`, do not issue another respawn because the old runtime may still own Gateway sessions; investigate and restart the host/container after it is gone.

## Evaluation and core client changes

- `broadcastEval` now supports `cluster`, `shard`, `guildId`, and `useAllSettled`; `guildId` cannot be combined with `cluster` or `shard`.
- `evalOnGuild` routes to the owning Discord.js cluster and receives the cached guild as its third callback argument; it intentionally rejects for `ShardingCoreClient` because core does not provide a guild cache.
- `ShardingCoreClient.gateway` and `ShardingCoreClient.rest` are typed as `WebSocketManager` and `REST`; use `await client.gateway.connect()` after construction.
- Read the full usage and operations guide in [USAGE.md](./USAGE.md) before deploying v2.
