# Revised Rewrite Strategy for `status-sharding`

## 1. Preserve the Existing Structure

Keep the current organization almost exactly as it is:

```text
src/
├── classes/
│   ├── child.ts
│   ├── listen.ts
│   └── worker.ts
│
├── core/
│   ├── client.ts
│   ├── cluster.ts
│   ├── clusterClient.ts
│   ├── clusterManager.ts
│   └── coreClient.ts
│
├── handlers/
│   ├── broker.ts
│   ├── message.ts
│   ├── promise.ts
│   └── queue.ts
│
├── other/
│   ├── map.ts
│   ├── message.ts
│   ├── shardingUtils.ts
│   └── utils.ts
│
├── plugins/
│   ├── heartbeat.ts
│   └── reCluster.ts
│
├── core.ts
├── index.ts
└── types.ts
```

There is no reason to introduce folders such as `runtime/`, `health/`, `internal/`, `protocol/`, and `scheduler/`.

The existing layout already separates concerns clearly. The contents need rewriting, not the directory design.

---

# 2. Preserve Both Client Implementations

Both clients remain first-class supported clients.

## Discord.js client

Preserve:

```ts
export class ShardingClient<
  Ready extends boolean = boolean,
  InternalManager extends RefClusterManager = RefClusterManager,
> extends DiscordClient<Ready>
```

It must continue to:

- extend the real Discord.js `Client`;
- preserve Discord.js's `Ready` generic;
- set `shards` using `ClusterClientData.ShardList`;
- set `shardCount` using `ClusterClientData.TotalShards`;
- expose `client.cluster`;
- trigger cluster readiness when all assigned shards are ready;
- preserve Discord.js event typing.

The modified Discord.js event map remains:

```ts
export type ClientEventsModifiable = Omit<
  ClientEvents,
  "ready" | "clientReady"
> & {
  clientReady: [client: ShardingClient];
};
```

## `@discordjs/core` client

Preserve:

```ts
export class ShardingCoreClient<
  InternalManager extends RefClusterManager = RefClusterManager,
> extends DiscordCoreClient
```

It must continue to:

- construct the REST client;
- construct the `WebSocketManager`;
- assign only this cluster's shard IDs;
- use the total global shard count;
- expose `client.cluster`;
- preserve `MappedEvents` typing;
- trigger cluster readiness after all assigned core shards are ready.

The shared child-side type remains:

```ts
export type ClientRefType =
  | RefShardingClient
  | RefShardingCoreClient;
```

The lifecycle rewrite must not assume that the internal client is always a Discord.js `Client`.

---

# 3. Preserve the Generic Type Chain

The generic relationships are one of the stronger parts of the current package and should be improved rather than removed.

## `ClusterManager`

Preserve:

```ts
export class ClusterManager<
  InternalClient extends ClientRefType = ClientRefType,
  InternalCluster extends RefCluster = RefCluster,
> extends EventEmitter
```

`InternalClient` must flow into:

- `broadcastEval`;
- `evalOnClusterClient`;
- `evalOnGuild`;
- clusters created by the manager;
- child-side `ClusterClient`;
- manager event types.

`InternalCluster` must flow into:

- `manager.clusters`;
- `respawnAll`;
- `respawnClusters`;
- `evalOnCluster`;
- `clusterCreate`;
- `clusterReady`.

## `Cluster`

Preserve:

```ts
export class Cluster<
  InternalManager extends RefClusterManager = RefClusterManager,
  InternalClient extends ClientRefType = ClientRefType,
> extends EventEmitter
```

The generics must continue through:

```ts
cluster.eval<T, P, C = Cluster<InternalManager, InternalClient>>(...)
cluster.evalOnClient<T, P, C = InternalClient>(...)
cluster.evalOnGuild<T, P, C = InternalClient>(...)
```

## `ClusterClient`

Preserve:

```ts
export class ClusterClient<
  InternalClient extends ClientRefType = ClientRefType,
  InternalManager extends RefClusterManager = RefClusterManager,
> extends EventEmitter
```

The generics must continue through:

```ts
clusterClient.evalOnManager<T, P, M = InternalManager>(...)
clusterClient.broadcastEval<T, P, C = InternalClient>(...)
clusterClient.evalOnClient<T, P, C = InternalClient>(...)
clusterClient.evalOnGuild<T, P, C = InternalClient>(...)
```

## Improve generic event propagation

The existing event interfaces currently fall back to broad `Cluster`, `ClusterManager`, and `ClusterClient` types.

They should become generic while retaining defaults:

```ts
export interface ClusterManagerEvents<
  InternalManager extends RefClusterManager = RefClusterManager,
  InternalCluster extends RefCluster = RefCluster,
> {
  clientRequest: [message: ProcessMessage];
  clusterCreate: [cluster: InternalCluster];
  clusterReady: [cluster: InternalCluster];
  message: [message: ProcessMessage];
  debug: [debugMessage: string];
  ready: [manager: InternalManager];
}
```

The same should be done for `ClusterEvents` and `ClusterClientEvents`.

That means custom clients and clusters remain correctly typed inside event listeners:

```ts
manager.on("clusterReady", cluster => {
  // cluster is the user's InternalCluster type
});

cluster.evalOnClient(client => {
  // client is the user's InternalClient type
});
```

---

# 4. Preserve the Existing Public Manager Face

The rewritten `ClusterManager` should retain these properties:

```ts
manager.ready
manager.file
manager.options
manager.broker
manager.promise
manager.clusters
manager.reCluster
manager.heartbeat
manager.clusterQueue
```

And these methods:

```ts
manager.spawn()
manager.broadcast()
manager.respawnAll()
manager.respawnClusters()

manager.eval()
manager.broadcastEval()
manager.evalOnClusterClient()
manager.evalOnCluster()
manager.evalOnGuild()

manager.createCluster()
manager._debug()
```

Signatures should remain compatible wherever the existing signature is sound.

Unsafe or incorrect typings may be corrected without changing the method name.

For example, `createCluster` should properly return the manager's custom cluster type:

```ts
public createCluster(
  id: number,
  shardsToSpawn: number[],
  recluster?: boolean,
): InternalCluster
```

A protected factory can allow custom cluster implementations:

```ts
protected createClusterInstance(
  id: number,
  shards: readonly number[],
): InternalCluster
```

The public method remains the same. The generic behavior becomes more accurate.

---

# 5. Preserve the Existing Cluster Face

Keep these readable properties:

```ts
cluster.manager
cluster.id
cluster.shardList
cluster.totalShards
cluster.totalClusters

cluster.ready
cluster.exited
cluster.respawning
cluster.thread
cluster.lastHeartbeatReceived
```

Keep these methods:

```ts
cluster.spawn()
cluster.kill()
cluster.respawn()

cluster.send()
cluster.request()
cluster.broadcast()

cluster.eval()
cluster.evalOnClient()
cluster.evalOnGuild()

cluster._sendInstance()
```

Internally, `ready`, `exited`, `respawning`, and `thread` should become getters backed by one private lifecycle state.

For compatibility, consumers can still read:

```ts
cluster.ready
cluster.exited
cluster.respawning
cluster.thread
```

But external code should not be able to assign values that corrupt lifecycle state.

The internal representation can be simple:

```ts
type ClusterState =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "failed";
```

```ts
private state: ClusterState = "stopped";
private desiredState: "running" | "stopped" = "stopped";
private generation = 0;
private activeThread: Child | Worker | null = null;
```

Then expose compatibility getters:

```ts
public get ready(): boolean {
  return this.state === "ready";
}

public get exited(): boolean {
  return this.activeThread === null;
}

public get respawning(): boolean {
  return this.currentOperation === "respawn";
}

public get thread(): Child | Worker | null {
  return this.activeThread;
}
```

This preserves the face while removing contradictory combinations such as:

```text
ready = true
thread = null
exited = false
```

---

# 6. Preserve the Existing ClusterClient Face

Keep all existing child-side properties and methods:

```ts
clusterClient.client
clusterClient.ready
clusterClient.promise
clusterClient.broker
clusterClient.process

clusterClient.id
clusterClient.totalShards
clusterClient.totalClusters
clusterClient.info

clusterClient.isReadyForHeartbeatAck()

clusterClient.send()
clusterClient.broadcast()
clusterClient.request()

clusterClient.evalOnManager()
clusterClient.broadcastEval()
clusterClient.evalOnClient()
clusterClient.evalOnGuild()

clusterClient.respawnAll()
clusterClient.respawnClusters()

clusterClient.triggerReady()
clusterClient.spawnNextCluster()

clusterClient._sendInstance()
clusterClient._respond()
clusterClient._debug()
```

The request generic should be corrected.

The current child-side request method effectively ties the output to the input type. It should match the cluster-side pattern:

```ts
public request<
  T extends Serializable,
  O = unknown,
>(
  message: SerializableInput<T>,
  options?: { timeout?: number },
): Promise<Serialized<O>>
```

Existing calls without an output generic still work.

Typed calls become possible:

```ts
const stats = await client.cluster.request<
  { command: "stats" },
  { guilds: number; users: number }
>({ command: "stats" });
```

---

# 7. Preserve All Existing Event Emitters

## Manager events

Do not remove or rename:

```ts
clientRequest
clusterCreate
clusterReady
message
debug
ready
```

## Cluster events

Do not remove or rename:

```ts
message
death
spawn
ready
debug
error
```

## ClusterClient events

Do not remove or rename:

```ts
managerReady
message
ready
debug
```

## Discord.js client events

`ShardingClient` continues to emit the normal Discord.js `ClientEvents`, with the corrected `ready` and `clientReady` client type.

## Core client events

`ShardingCoreClient` continues to use `MappedEvents`.

## Typed EventEmitter overloads

Retain the declaration-merging pattern:

```ts
export declare interface ClusterManager<
  InternalClient extends ClientRefType = ClientRefType,
  InternalCluster extends RefCluster = RefCluster,
> {
  emit<K extends keyof ClusterManagerEvents<this, InternalCluster>>(
    event: K,
    ...args: ClusterManagerEvents<this, InternalCluster>[K]
  ): boolean;

  on<K extends keyof ClusterManagerEvents<this, InternalCluster>>(
    event: K,
    listener: (
      ...args: ClusterManagerEvents<this, InternalCluster>[K]
    ) => void,
  ): this;

  once<K extends keyof ClusterManagerEvents<this, InternalCluster>>(
    event: K,
    listener: (
      ...args: ClusterManagerEvents<this, InternalCluster>[K]
    ) => void,
  ): this;

  off<K extends keyof ClusterManagerEvents<this, InternalCluster>>(
    event: K,
    listener: (
      ...args: ClusterManagerEvents<this, InternalCluster>[K]
    ) => void,
  ): this;
}
```

The implementation may also add new diagnostic events, but additions must not replace the established events.

Useful additive events could include:

```ts
clusterState
clusterRestart
clusterRestartFailed
clusterTerminationFailed
clusterHealthFailure
```

The original `death` event must still fire exactly once for each unexpected failure episode.

---

# 8. Keep `ProcessMessage` and the Message Generics

Retain:

```ts
DataType
DataTypes<A, P>
BaseMessage<D, A, P>
BaseMessageInput<D, A>
ProcessMessage<D, A, P>
MessageTypes
```

The message envelope can be extended internally with optional ownership fields:

```ts
export type BaseMessage<
  D extends DataType,
  A = Serializable,
  P extends object = object,
> = {
  _type: MessageTypes;
  _nonce: string;
  _clusterId?: number;
  _generation?: number;
  data: DataTypes<A, P>[D];
};
```

This keeps existing manually constructed messages working while allowing the manager to reject stale responses.

`ProcessMessage.reply()` remains:

```ts
message.reply(data)
```

It should reply using the same nonce, cluster ID, and generation as the incoming request.

---

# 9. Keep `CustomMap` Ergonomics

Preserve:

```ts
map.update()
map.map()
map.filter()
map.find()
map.every()
```

`manager.clusters` should remain iterable and support:

```ts
manager.clusters.get(id)
manager.clusters.has(id)
manager.clusters.map(...)
manager.clusters.filter(...)
manager.clusters.find(...)
manager.clusters.every(...)
manager.clusters.values()
manager.clusters.keys()
```

The only behavior that should change is external topology mutation.

External calls such as these must not detach live clusters:

```ts
manager.clusters.clear()
manager.clusters.delete(id)
manager.clusters.set(id, cluster)
```

This can be implemented in `other/map.ts` without changing the directory layout:

```ts
export class ClusterMap<K, V> extends CustomMap<K, V> {
  public set(): this {
    throw new Error("CLUSTER_COLLECTION_READ_ONLY");
  }

  public delete(): boolean {
    throw new Error("CLUSTER_COLLECTION_READ_ONLY");
  }

  public clear(): void {
    throw new Error("CLUSTER_COLLECTION_READ_ONLY");
  }

  public _setInternal(key: K, value: V): this {
    return super.set(key, value);
  }

  public _deleteInternal(key: K): boolean {
    return super.delete(key);
  }
}
```

The manager uses the internal methods. Consumers retain all normal read and collection-helper behavior.

---

# 10. Rewrite Responsibilities Within the Existing Files

## `classes/child.ts`

Responsible only for:

- spawning a child process;
- sending messages;
- reporting process events;
- graceful termination;
- forced termination;
- verifying process death.

It must not:

- respawn automatically;
- emit cluster death;
- clear cluster state;
- remove listeners belonging to `Cluster`.

Keep:

```ts
Child.spawn()
Child.respawn()
Child.kill()
Child.send()

ChildClient.send()
ChildClient.ipc
```

`Child.respawn()` may remain for compatibility, but `Cluster` should normally coordinate replacement.

## `classes/worker.ts`

Same responsibility as `child.ts`, using:

- worker `exit` as authoritative;
- `worker.terminate()` as the termination promise;
- an explicit exited flag rather than `threadId`.

Keep:

```ts
Worker.spawn()
Worker.respawn()
Worker.kill()
Worker.send()

WorkerClient.send()
WorkerClient.ipc
```

## `classes/listen.ts`

Keep the listener helper.

Change it so listeners belong to one specific process or worker generation.

It removes only listeners that it installed. It must never call unrestricted `removeAllListeners()` on a process owned by another class.

## `core/cluster.ts`

This becomes the only lifecycle authority.

It owns:

- spawn;
- kill;
- respawn;
- current generation;
- current process or worker;
- readiness;
- unexpected exit handling;
- death-event deduplication;
- recovery requests.

No other file directly replaces a cluster runtime.

## `core/clusterManager.ts`

Owns:

- topology;
- cluster creation;
- fleet spawning;
- fleet respawning;
- broadcasts;
- eval routing;
- queue coordination;
- session-budget coordination;
- manager readiness.

It should not duplicate per-cluster lifecycle code.

## `core/clusterClient.ts`

Remains the child-facing API.

It owns:

- child IPC;
- manager requests;
- broadcast requests;
- eval requests;
- readiness reporting;
- heartbeat replies;
- gateway state reporting.

It does not restart its own process.

## `handlers/message.ts`

Responsible only for:

- validating incoming messages;
- routing by `MessageTypes`;
- resolving replies;
- invoking the correct manager or client operation;
- converting handler failures into IPC error replies.

No lifecycle state should live here.

## `handlers/promise.ts`

Keep `PromiseHandler`, but key promises by ownership:

```text
cluster ID + generation + nonce
```

It must:

- enforce finite timeouts;
- reject immediately when sending fails;
- reject all promises for an exited generation;
- reject duplicate nonces;
- enforce a configurable pending-request limit.

## `handlers/queue.ts`

Keep:

```ts
queue.start()
queue.next()
queue.stop()
queue.resume()
queue.add()
```

Correct its behavior so:

- item failures reject the owning operation;
- errors are not printed and swallowed;
- clearing or stopping rejects waiting callers;
- only one queue runner executes;
- delay happens between items, not after the final item;
- manual mode remains supported through `spawnNextCluster()`.

## `handlers/broker.ts`

Keep the broker API:

```ts
broker.listen()
broker.send()
```

Add message validation and generation ownership where applicable.

## `plugins/heartbeat.ts`

Keep `HeartbeatManager`.

It may:

- send heartbeat probes;
- validate acknowledgements;
- track missed probes;
- track shard gateway instability;
- report unhealthy generations.

It may not directly call cluster `spawn`, `kill`, or `respawn`.

It reports the problem to `Cluster`, and `Cluster` owns the transition.

## `plugins/reCluster.ts`

Keep:

```ts
manager.reCluster.active
manager.reCluster.start(options)
```

`ReClusterManager` coordinates the operation but uses normal cluster methods.

It must not directly overwrite manager maps while old or new processes may still be alive.

## `other/message.ts`

Keep all message and `ProcessMessage` types.

Add only the minimum ownership metadata needed for safe IPC correlation.

## `other/shardingUtils.ts`

Keep shard calculation, nonce generation, eval parsing, delays, gateway fetching, and general sharding utilities.

Lifecycle state must not be hidden in utility methods.

## `types.ts`

Keep the central public types file.

Add lifecycle and diagnostic types here instead of introducing another folder.

---

# 11. The Actual Lifecycle Can Stay Small

Internally, `Cluster` only needs:

```ts
private state:
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "failed";

private desiredState: "running" | "stopped";
private generation: number;
private activeThread: Child | Worker | null;
private operation: Promise<unknown>;
private deathGeneration: number | null;
```

All lifecycle methods execute through one serialized operation chain:

```ts
cluster.spawn()
cluster.kill()
cluster.respawn()
```

Heartbeat, exit handlers, disconnect handlers, and manager operations submit work to that chain.

There is no need for several overlapping fields such as:

```text
stopping
killing
respawning
exited
ready
deathEmitted
killPromise
respawnPromise
```

Compatibility getters can expose the expected public values without using those booleans as independent sources of truth.

---

# 12. Compatibility Is a Release Requirement

Before implementing lifecycle logic, create TypeScript fixtures proving these continue compiling:

```ts
class BotManager extends ClusterManager<BotClient, BotCluster> {}

class BotCluster extends Cluster<BotManager, BotClient> {}

class BotClient extends ShardingClient<boolean, BotManager> {}

class BotCoreClient extends ShardingCoreClient<BotManager> {}
```

Test all current surfaces:

```ts
manager.spawn()
manager.clusters.map(...)
manager.broadcastEval(...)
manager.evalOnCluster(...)
manager.evalOnClusterClient(...)
manager.evalOnGuild(...)
manager.reCluster.start(...)

cluster.spawn()
cluster.kill()
cluster.respawn()
cluster.request(...)
cluster.evalOnClient(...)
cluster.evalOnGuild(...)

client.cluster.send(...)
client.cluster.request(...)
client.cluster.evalOnManager(...)
client.cluster.broadcastEval(...)
client.cluster.respawnAll(...)
client.cluster.spawnNextCluster(...)
```

Test event inference:

```ts
manager.on("clusterCreate", cluster => {});
manager.on("clusterReady", cluster => {});
manager.on("clientRequest", message => {});
manager.on("ready", manager => {});

cluster.on("spawn", (cluster, thread) => {});
cluster.on("death", (cluster, thread) => {});
cluster.on("ready", cluster => {});
cluster.on("message", message => {});
cluster.on("error", error => {});

client.cluster.on("managerReady", () => {});
client.cluster.on("ready", clusterClient => {});
client.cluster.on("message", message => {});
```

Both Discord.js and `@discordjs/core` examples must compile and run before the rewrite is considered API-compatible.

---

# 13. Final Direction

This should be a rewrite of the implementation, not a redesign of the package users interact with.

The package should still feel like `status-sharding`:

```ts
const manager = new ClusterManager<BotClient, BotCluster>(
  "./bot.js",
  options,
);

manager.on("clusterCreate", cluster => {
  cluster.on("death", handleDeath);
});

await manager.spawn();
```

And inside the cluster:

```ts
const client = new ShardingClient<true, BotManager>(options);

client.cluster.on("managerReady", () => {
  // Existing child-facing behavior
});

await client.login(token);
```

The simplification happens behind those APIs:

```text
Child and Worker manage runtime handles.
Cluster owns one runtime lifecycle.
ClusterManager owns topology.
Queue orders starts.
Heartbeat observes health.
MessageHandler routes IPC.
PromiseHandler owns request promises.
ReClusterManager coordinates normal lifecycle calls.
```

That keeps the package compact, familiar, generic, and strongly typed without retaining the unsafe internal races.
