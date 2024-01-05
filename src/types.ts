import { ChildProcess, Serializable as ChildSerializable } from 'child_process';
import { ClusterManager } from './core/clusterManager';
import { WorkerThreadOptions } from './classes/worker';
import { ChildProcessOptions } from './classes/child';
import { ClusterClient } from './core/clusterClient';
import { ProcessMessage } from './other/message';
import { Cluster } from './core/cluster';
import { Worker } from 'worker_threads';

export const DefaultOptions = {
	http: {
		api: 'https://discord.com/api',
		version: '10',
	},
};

export const Endpoints = {
	botGateway: '/gateway/bot',
};

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

export type Awaitable<T> = T | PromiseLike<T>;
export type ClusteringMode = 'worker' | 'process';
export type UnknownFunction = (...args: unknown[]) => unknown;
export type HeartbeatData = { restarts: number; missedBeats: number; };
export type RequiredProps<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
export type DeepNonNullable<T> = T extends NonNullable<T> ? T : DeepNonNullable<NonNullable<T>>;
export type ValidIfSerializable<T> = T extends NonNullable<Serializable> ? (T | undefined) : never;
export type SerializableInput<T, U = false> = T extends Serializable ? T : T extends unknown ? U : never;
export type DeconstructedFunction = { args: string[], body: string, wrapScope: boolean, wrapArgs: boolean };
export type Serializable = string | number | boolean | null | undefined | Serializable[] | { [key: string]: Serializable } | object | ChildSerializable;
export type Serialized<T> = T extends symbol | bigint | UnknownFunction ? never : T extends ValidIfSerializable<T> ? T : (T extends { toJSON(): infer R } ? R : T extends ReadonlyArray<infer V> ? Serialized<V>[] : (T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? object : (T extends object ? { [K in keyof T]: Serialized<T[K]> } : T)));

export interface ClusterManagerCreateOptions<T extends ClusteringMode> {
    mode?: T; // Which mode to use for clustering.
    token?: string; // The token of the discord bot.
    totalShards?: number; // Number of total internal shards or -1.
    totalClusters?: number; // Number of total Clusters/Process to spawn.
    shardsPerClusters?: number; // Number of shards per cluster.
    shardArgs?: string[]; // Arguments to pass to the clustered script when spawning (only available when using the `process` mode).
    execArgv?: string[]; // Arguments to pass to the clustered script executable when spawning.
    respawn?: boolean; // Whether clusters should automatically respawn upon exiting.
    heartbeat?: ClusterHeartbeatOptions; // Heartbeat options.
    queueOptions?: QueueOptions; // Control the Spawn Queue.
    spawnOptions?: ClusterSpawnOptions; // Options to pass to the spawn, respawn method.
    clusterData?: object; // Data, which is passed to the Cluster.
    clusterOptions?: T extends 'worker' ? WorkerThreadOptions : ChildProcessOptions; // Options, which is passed when forking a child or creating a thread.
}

export interface ClusterManagerOptions<T extends ClusteringMode> extends ClusterManagerCreateOptions<T> {
    mode: T; // Which mode to use for clustering.
    totalShards: number; // Number of total internal shards or -1.
    totalClusters: number; // Number of total Clusters/Process to spawn.
    shardsPerClusters: number; // Number of shards per cluster.
    shardList: number[]; // An Array of Internal Shards Ids, which should get spawned.
    clusterList: number[]; // An Array of Ids to assign to the spawned Clusters, when the default id scheme is not wanted.
    spawnOptions: Required<ClusterSpawnOptions>; // Options to pass to the spawn, respawn method.
    heartbeat: Required<ClusterHeartbeatOptions>; // Heartbeat options.
}

export interface ClusterClientData {
	ShardList: number[];
	TotalShards: number;
	ClusterCount: number;
	ClusterId: number;
	ClusterManagerMode: ClusteringMode;
	ClusterQueueMode?: 'auto' | 'manual';
	FirstShardId: number;
	LastShardId: number;
}

export interface ClusterSpawnOptions {
    delay?: number;
    timeout?: number;
}

export interface ClusterHeartbeatOptions {
    maxMissedHeartbeats?: number; // Maximum amount of missed heartbeats a cluster can have in the interval.
    maxRestarts?: number; // Maximum amount of restarts a cluster can have in the interval.
    interval?: number; // Interval in milliseconds between each heartbeat.
    timeout?: number; // Timeout in milliseconds after which a cluster will be considered as unresponsive.
}

export interface QueueOptions {
    mode?: 'auto' | 'manual'; // Whether the spawn queue be automatically managed.
    timeout?: number; // Time to wait until next item.
}

export interface ClusterKillOptions {
    reason?: string;
    force: boolean;
}

// Eval.
export interface EvalOptions<T extends object = object> {
    cluster?: number | number[];
    shard?: number | number[];
    guildId?: string;
    context?: T;
    timeout?: number;
    useAllSettled?: boolean;
}

// ReCluster.
export type ReClusterRestartMode = 'gracefulSwitch' | 'rolling';

export interface ReClusterOptions {
	totalShards?: number; // The new totalShards of the bot.
	totalClusters?: number; // The amount of totalClusters to spread the shards over all clusters.
	shardsPerClusters?: number; // The amount of shards per cluster.

	restartMode?: ReClusterRestartMode; // The restartMode of the clusterManager, gracefulSwitch = waits until all new clusters have spawned with maintenance mode, rolling = Once the Cluster is Ready, the old cluster will be killed.
}

// Promises.
export interface StoredPromise {
	timeout?: NodeJS.Timeout;

	resolve(value: unknown): void;
	reject(error: Error): void;
}

// Events.
export interface ClusterManagerEvents {
    clientRequest: [message: ProcessMessage];
    clusterCreate: [cluster: Cluster];
    clusterReady: [cluster: Cluster];
    message: [message: ProcessMessage];
    debug: [debugMessage: string];
    ready: [manager: ClusterManager];
}

export interface ClusterEvents {
    message: [message: ProcessMessage];
    death: [cluster: Cluster, thread: ChildProcess | Worker | undefined | null];
    spawn: [thread: ChildProcess | Worker | undefined | null];
    ready: [cluster: Cluster];
    debug: [message: string];
    error: [error: Error];
}

export interface ClusterClientEvents {
    message: [message: ProcessMessage];
    ready: [clusterClient: ClusterClient];
}
