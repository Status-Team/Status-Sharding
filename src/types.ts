import { ChildProcess, Serializable as ChildSerializable } from 'child_process';
import { ClusterManager } from './core/clusterManager';
import { WorkerThreadOptions } from './classes/worker';
import { ChildProcessOptions } from './classes/child';
import { ClusterClient } from './core/clusterClient';
import { ProcessMessage } from './other/message';
import { Cluster } from './core/cluster';
import { Worker } from 'worker_threads';

/**
 * Default options for fetching the bot gateway.
 * @type {{ http: { api: string; version: string; }; }}
 */
export const DefaultOptions = {
	http: {
		api: 'https://discord.com/api',
		version: '10',
	},
};

/**
 * Endpoints for the discord api.
 * @type {{ botGateway: string; }}
 */
export const Endpoints = {
	botGateway: '/gateway/bot',
};

/**
 * The types of data that can be sent.
 * @export
 * @enum {number}
 */
export enum MessageTypes {
    'MissingType',
    'CustomRequest',
    'CustomMessage',
    'CustomReply',
    'Heartbeat',
    'HeartbeatAck',
    'ClientBroadcast',
    'ClientBroadcastRequest',
    'ClientBroadcastResponse',
    'ClientBroadcastResponseError',
    'ClientRespawn',
    'ClientRespawnAll',
    'ClientMaintenance',
    'ClientMaintenanceEnable',
    'ClientMaintenanceDisable',
    'ClientMaintenanceAll',
    'ClientSpawnNextCluster',
    'ClientReady',
    'ClientEvalRequest',
    'ClientEvalResponse',
    'ClientEvalResponseError',
    'ClientManagerEvalRequest',
    'ClientManagerEvalResponse',
    'ClientManagerEvalResponseError',
}

/**
 * Awaitable type.
 * @export
 * @typedef {Awaitable}
 * @template {unknown} T - The type to await.
 */
export type Awaitable<T> = T | PromiseLike<T>;
/**
 * Mode for clustering.
 * @export
 * @typedef {ClusteringMode}
 */
export type ClusteringMode = 'worker' | 'process';
/**
 * Any function.
 * @export
 * @typedef {UnknownFunction}
 */
export type UnknownFunction = (...args: unknown[]) => unknown;
/**
 * Data for restart sysytem.
 * @export
 * @typedef {HeartbeatData}
 */
export type HeartbeatData = { restarts: number; missedBeats: number; };
/**
 * Type that removes null and undefined from a type.
 * @export
 * @typedef {DeepNonNullable}
 * @template {unknown} T - The type to remove null and undefined from.
 */
export type DeepNonNullable<T> = T extends NonNullable<T> ? T : DeepNonNullable<NonNullable<T>>;
/**
 * Check for function's outputs.
 * @export
 * @typedef {ValidIfSerializable}
 * @template {unknown} T - The type to check.
 */
export type ValidIfSerializable<T> = T extends NonNullable<Serializable> ? (T | undefined) : never;
/**
 * Check if input is serializable.
 * @export
 * @typedef {SerializableInput}
 * @template {unknown} T - The type to check.
 * @template {unknown} [U=false] - Whether to allow unknown types.
 */
export type SerializableInput<T, U = false> = T extends Serializable ? T : T extends unknown ? U : never;
/**
 * Output of guild function parser.
 * @export
 * @typedef {DeconstructedFunction}
 */
export type DeconstructedFunction = { args: string[], body: string, wrapScope: boolean, wrapArgs: boolean; isAsync: boolean; };
/**
 * Any object or data.
 * @export
 * @typedef {Serializable}
 */
export type Serializable = string | number | boolean | null | undefined | Serializable[] | { [key: string]: Serializable } | object | ChildSerializable;
/**
 * Already serialized data.
 * @export
 * @typedef {Serialized}
 * @template {unknown} T - The type to serialize.
 */
export type Serialized<T> = T extends symbol | bigint | UnknownFunction ? never : T extends ValidIfSerializable<T> ? T : (T extends { toJSON(): infer R } ? R : T extends ReadonlyArray<infer V> ? Serialized<V>[] : (T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? object : (T extends object ? { [K in keyof T]: Serialized<T[K]> } : T)));

/**
 * Options for the cluster manager.
 * @export
 * @interface ClusterManagerCreateOptions
 * @typedef {ClusterManagerCreateOptions}
 * @template {ClusteringMode} T - The type of the clustering mode.
 */
export interface ClusterManagerCreateOptions<T extends ClusteringMode> {
    /**
     * What mode to use for clustering.
     * @type {?T}
     */
    mode?: T;
    /**
     * The token of the discord bot.
     * @type {?string}
     */
    token?: string;
    /**
     * Number of total internal shards or -1.
     * @type {?number}
     */
    totalShards?: number;
    /**
     * Number of total Clusters/Process to spawn.
     * @type {?number}
     */
    totalClusters?: number;
    /**
     * Number of shards per cluster.
     * @type {?number}
     */
    shardsPerClusters?: number;
    /**
     * Arguments to pass to the clustered script when spawning (only available when using the `process` mode).
     * @type {?string[]}
     */
    shardArgs?: string[];
    /**
     * Arguments to pass to the clustered script executable when spawning.
     * @type {?string[]}
     */
    execArgv?: string[];
    /**
     * Whether clusters should automatically respawn upon exiting.
     * @type {?boolean}
     */
    respawn?: boolean;
    /**
     * Heartbeat options.
     * @type {?ClusterHeartbeatOptions}
     */
    heartbeat?: ClusterHeartbeatOptions;
    /**
     * Control the Spawn Queue.
     * @type {?QueueOptions}
     */
    queueOptions?: QueueOptions;
    /**
     * Options to pass to the spawn, respawn method.
     * @type {?ClusterSpawnOptions}
     */
    spawnOptions?: ClusterSpawnOptions;
    /**
     * Data, which is passed to the Cluster.
     * @type {?object}
     */
    clusterData?: object;
    /**
     * Options, which is passed when forking a child or creating a thread.
     * @type {?T extends 'worker' ? WorkerThreadOptions : ChildProcessOptions}
     */
    clusterOptions?: T extends 'worker' ? WorkerThreadOptions : ChildProcessOptions;
}

/**
 * Options for the cluster manager.
 * @export
 * @interface ClusterManagerOptions
 * @typedef {ClusterManagerOptions}
 * @template {ClusteringMode} T - The type of the clustering mode.
 * @extends {ClusterManagerCreateOptions<T>}
 */
export interface ClusterManagerOptions<T extends ClusteringMode> extends ClusterManagerCreateOptions<T> {
    /**
     * Which mode to use for clustering.
     * @type {T}
     */
    mode: T;
    /**
     * Number of total internal shards or -1.
     * @type {number}
     */
    totalShards: number;
    /**
     * Number of total Clusters/Process to spawn.
     * @type {number}
     */
    totalClusters: number;
    /**
     * Number of shards per cluster.
     * @type {number}
     */
    shardsPerClusters: number;
    /**
     * An Array of Internal Shards Ids, which should get spawned.
     * @type {number[]}
     */
    shardList: number[];
    /**
     * An Array of Ids to assign to the spawned Clusters, when the default id scheme is not wanted.
     * @type {number[]}
     */
    clusterList: number[];
    /**
     * Options to pass to the spawn, respawn method.
     * @type {Required<ClusterSpawnOptions>}
     */
    spawnOptions: Required<ClusterSpawnOptions>;
    /**
     * Heartbeat options.
     * @type {Required<ClusterHeartbeatOptions>}
     */
    heartbeat: Required<ClusterHeartbeatOptions>;
}

/**
 * Data of ClusterClient.
 * @export
 * @interface ClusterClientData
 * @typedef {ClusterClientData}
 */
export interface ClusterClientData {
	/**
     * List of shards that are assigned to this cluster.
     * @type {number[]}
     */
    ShardList: number[];
	/**
     * The total amount of shards.
     * @type {number}
     */
    TotalShards: number;
	/**
     * The total amount of clusters.
     * @type {number}
     */
    ClusterCount: number;
	/**
     * The id of the cluster.
     * @type {number}
     */
    ClusterId: number;
	/**
     * Mode of the manager.
     * @type {ClusteringMode}
     */
    ClusterManagerMode: ClusteringMode;
	/**
     * Mode of the queue.
     * @type {?('auto' | 'manual')}
     */
    ClusterQueueMode?: 'auto' | 'manual';
	/**
     * First shard id of the cluster.
     * @type {number}
     */
    FirstShardId: number;
	/**
     * Last shard id of the cluster.
     * @type {number}
     */
    LastShardId: number;
}

/**
 * Spawn options for the cluster.
 * @export
 * @interface ClusterSpawnOptions
 * @typedef {ClusterSpawnOptions}
 */
export interface ClusterSpawnOptions {
    /**
     * How long to wait between spawning each cluster.
     * @type {?number}
     */
    delay?: number;
    /**
     * How long to wait for a cluster to become ready before killing it and retrying.
     * @type {?number}
     */
    timeout?: number;
}

/**
 * Data for the heartbeat system.
 * @export
 * @interface ClusterHeartbeatOptions
 * @typedef {ClusterHeartbeatOptions}
 */
export interface ClusterHeartbeatOptions {
    /**
     * Maximum amount of missed heartbeats a cluster can have in the interval.
     * @type {?number}
     */
    maxMissedHeartbeats?: number;
    /**
     * Maximum amount of restarts a cluster can have in the interval.
     * @type {?number}
     */
    maxRestarts?: number;
    /**
     * Interval in milliseconds between each heartbeat.
     * @type {?number}
     */
    interval?: number;
    /**
     * Timeout in milliseconds after which a cluster will be considered as unresponsive.
     * @type {?number}
     */
    timeout?: number;
}

/**
 * Options for the queue.
 * @export
 * @interface QueueOptions
 * @typedef {QueueOptions}
 */
export interface QueueOptions {
    /**
     * Whether the spawn queue be automatically managed.
     * @type {?('auto' | 'manual')}
     */
    mode?: 'auto' | 'manual';
    /**
     * Time to wait until next item.
     * @type {?number}
     */
    timeout?: number;
}

/**
 * Kill options for the cluster.
 * @export
 * @interface ClusterKillOptions
 * @typedef {ClusterKillOptions}
 */
export interface ClusterKillOptions {
    /**
     * The reason for killing the cluster.
     * @type {string}
     */
    reason: string;
}

/**
 * Eval options for the cluster.
 * @export
 * @interface EvalOptions
 * @typedef {EvalOptions}
 * @template {object} [T=object] - The type of the context.
 */
export interface EvalOptions<T extends object = object> {
    /**
     * Only run the script in a single cluster or set of clusters.
     * @type {?(number | number[])}
     */
    cluster?: number | number[];
    /**
     * On what shard to run the script.
     * @type {?(number | number[])}
     */
    shard?: number | number[];
    /**
     * On what guild to run the script.
     * @type {?string}
     */
    guildId?: string;
    /**
     * Context to use for the script.
     * @type {?T}
     */
    context?: T;
    /**
     * Timeout before the script is cancelled.
     * @type {?number}
     */
    timeout?: number;
    /**
     * Whether to continue running the script even if one of the clusters returns an error.
     * @type {?boolean}
     */
    useAllSettled?: boolean;
}

/**
 * Mode for reclustering.
 * @export
 * @typedef {ReClusterRestartMode}
 */
export type ReClusterRestartMode = 'gracefulSwitch' | 'rolling';

/**
 * Options for reclustering.
 * @export
 * @interface ReClusterOptions
 * @typedef {ReClusterOptions}
 */
export interface ReClusterOptions {
	/**
     * The new totalShards of the bot.
     * @type {?number}
     */
    totalShards?: number;
	/**
     * The amount of totalClusters to spread the shards over all clusters.
     * @type {?number}
     */
    totalClusters?: number;
	/**
     * The amount of shards per cluster.
     * @type {?number}
     */
    shardsPerClusters?: number;

	/**
     * The restartMode of the clusterManager, gracefulSwitch = waits until all new clusters have spawned with maintenance mode, rolling = Once the Cluster is Ready, the old cluster will be killed.
     * @type {?ReClusterRestartMode}
     */
    restartMode?: ReClusterRestartMode;
}

/**
 * Options for storing promises.
 * @export
 * @interface StoredPromise
 * @typedef {StoredPromise}
 */
export interface StoredPromise {
	/**
     * Timeout before promise is canceled.
     * @type {?NodeJS.Timeout}
     */
    timeout?: NodeJS.Timeout;

    /**
     * Resolves the promise.
     * @template {unknown} T - Type of data.
     * @param {unknown} value - Data that resolves the promise.
     */
    resolve(value: unknown): void;
	/**
     * Return an error if failed.
     * @param {Error} error - Error to return.
     */
    reject(error: Error): void;
}

/**
 * Events that manager emits.
 * @export
 * @interface ClusterManagerEvents
 * @typedef {ClusterManagerEvents}
 */
export interface ClusterManagerEvents {
    /**
     * Emits when client sends a request via IPC.
     * @type {[message: ProcessMessage]}
     */
    clientRequest: [message: ProcessMessage];
    /**
     * Emits when cluster is created.
     * @type {[cluster: Cluster]}
     */
    clusterCreate: [cluster: Cluster];
    /**
     * Emits when cluster is ready.
     * @type {[cluster: Cluster]}
     */
    clusterReady: [cluster: Cluster];
    /**
     * Emits when any message is sent from IPC.
     * @type {[message: ProcessMessage]}
     */
    message: [message: ProcessMessage];
    /**
     * Debug events.
     * @type {[debugMessage: string]}
     */
    debug: [debugMessage: string];
    /**
     * When all manager's clsuters are ready.
     * @type {[manager: ClusterManager]}
     */
    ready: [manager: ClusterManager];
}

/**
 * Events that cluster emits.
 * @export
 * @interface ClusterEvents
 * @typedef {ClusterEvents}
 */
export interface ClusterEvents {
    /**
     * Emits when any message is sent from IPC.
     * @type {[message: ProcessMessage]}
     */
    message: [message: ProcessMessage];
    /**
     * Emits when cluster dies.
     * @type {([cluster: Cluster, thread: ChildProcess | Worker | undefined | null])}
     */
    death: [cluster: Cluster, thread: ChildProcess | Worker | undefined | null];
    /**
     * Emits when cluster is spawned.
     * @type {([thread: ChildProcess | Worker | undefined | null])}
     */
    spawn: [thread: ChildProcess | Worker | undefined | null];
    /**
     * Emits when cluster is ready.
     * @type {[cluster: Cluster]}
     */
    ready: [cluster: Cluster];
    /**
     * Emits when debug message is sent.
     * @type {[message: string]}
     */
    debug: [message: string];
    /**
     * Emits when there is an error.
     * @type {[error: Error]}
     */
    error: [error: Error];
}

/**
 * Events that cluster client emits.
 * @export
 * @interface ClusterClientEvents
 * @typedef {ClusterClientEvents}
 */
export interface ClusterClientEvents {
    /**
     * Emits when message is sent from IPC.
     * @type {[message: ProcessMessage]}
     */
    message: [message: ProcessMessage];
    /**
     * Emits when cluster is ready.
     * @type {[clusterClient: ClusterClient]}
     */
    ready: [clusterClient: ClusterClient];
    /**
     * Emits when debug message is sent.
     * @type {[message: string]}
     */
    debug: [message: string];
}
