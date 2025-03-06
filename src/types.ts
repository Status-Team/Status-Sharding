import { ChildProcess, Serializable as ChildSerializable } from 'child_process';
import { WorkerThreadOptions } from './classes/worker';
import { ClusterManager } from './core/clusterManager';
import { ChildProcessOptions } from './classes/child';
import { ClusterClient } from './core/clusterClient';
import { ProcessMessage } from './other/message';
import { Cluster } from './core/cluster';
import { Worker } from 'worker_threads';

/** Default options for fetching the bot gateway. */
export const DefaultOptions = {
	http: {
		api: 'https://discord.com/api',
		version: '10',
	},
};

/** Endpoints for the discord api. */
export const Endpoints = {
	botGateway: '/gateway/bot',
};

/** The types of data that can be sent. */
export enum MessageTypes {
	'MissingType' = 0,
	'CustomRequest' = 1,
	'CustomMessage' = 2,
	'CustomReply' = 3,
	'Heartbeat' = 4,
	'HeartbeatAck' = 5,
	'ClientBroadcast' = 6,
	'ClientBroadcastRequest' = 7,
	'ClientBroadcastResponse' = 8,
	'ClientBroadcastResponseError' = 9,
	'ClientRespawn' = 10,
	'ClientRespawnAll' = 11,
	'ClientSpawnNextCluster' = 16,
	'ClientReady' = 17,
	'ClientEvalRequest' = 18,
	'ClientEvalResponse' = 19,
	'ClientEvalResponseError' = 20,
	'ClientManagerEvalRequest' = 21,
	'ClientManagerEvalResponse' = 22,
	'ClientManagerEvalResponseError' = 23,
	'ManagerReady' = 24,
	'Kill' = 25,
	'ClientRespawnSpecific' = 26,
}

/** Recursive array of strings. */
export type RecursiveStringArray = (RecursiveStringArray | string)[];

/** Awaitable type. */
export type Awaitable<T> = T | PromiseLike<T>;
/** Mode for clustering. */
export type ClusteringMode = 'worker' | 'process' | 'bunExperimental';
/** Any function. */
export type UnknownFunction = (...args: unknown[]) => unknown;
/** Data for restart sysytem. */
export type HeartbeatData = { restarts: number; missedBeats: number; killing: boolean; };
/** Type that removes null and undefined from a type. */
export type DeepNonNullable<T> = T extends NonNullable<T> ? T : DeepNonNullable<NonNullable<T>>;
/** Check for function's outputs. */
export type ValidIfSerializable<T> = T extends NonNullable<Serializable> ? (T | undefined) : never;
/** Check if input is serializable. */
export type SerializableInput<T, U = false> = T extends Serializable ? T : T extends unknown ? U : never;
/** Output of guild function parser. */
export type DeconstructedFunction = { args: (string | string[])[], body: string, wrapScope: boolean, wrapArgs: boolean; isAsync: boolean; };
/** Any object or data. */
export type Serializable = string | number | boolean | null | undefined | Serializable[] | { [key: string]: Serializable } | object | ChildSerializable;
/** Already serialized data. */
export type Serialized<T> = T extends symbol | bigint | UnknownFunction ? never : T extends ValidIfSerializable<T> ? T : (T extends { toJSON(): infer R } ? R : T extends ReadonlyArray<infer V> ? Serialized<V>[] : (T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? object : (T extends object ? { [K in keyof T]: Serialized<T[K]> } : T)));

/** Options for the cluster manager. */
export interface ClusterManagerCreateOptions<T extends ClusteringMode> {
	/** What mode to use for clustering. */
	mode?: T;
	/** The token of the discord bot. */
	token?: string;
	/** Number of total internal shards or -1. */
	totalShards?: number;
	/** Number of total Clusters/Process to spawn. */
	totalClusters?: number;
	/** Number of shards per cluster. */
	shardsPerClusters?: number;
	/** Arguments to pass to the clustered script when spawning (only available when using the `process` mode). */
	shardArgs?: string[];
	/** Arguments to pass to the clustered script executable when spawning. */
	execArgv?: string[];
	/** Whether clusters should automatically respawn upon exiting. */
	respawn?: boolean;
	/** Heartbeat options. */
	heartbeat?: ClusterHeartbeatOptions;
	/** Control the Spawn Queue. */
	queueOptions?: QueueOptions;
	/** Options to pass to the spawn, respawn method. */
	spawnOptions?: ClusterSpawnOptions;
	/** Data, which is passed to the Cluster. */
	clusterData?: object;
	/** Options, which is passed when forking a child or creating a thread. */
	clusterOptions?: T extends 'worker' ? WorkerThreadOptions : ChildProcessOptions;
}

/** Options for the cluster manager. */
export interface ClusterManagerOptions<T extends ClusteringMode> extends ClusterManagerCreateOptions<T> {
	/** Which mode to use for clustering. */
	mode: T;
	/** Number of total internal shards or -1. */
	totalShards: number;
	/** Number of total Clusters/Process to spawn. */
	totalClusters: number;
	/** Number of shards per cluster. */
	shardsPerClusters: number;
	/** An Array of Internal Shards Ids, which should get spawned. */
	shardList: number[];
	/** An Array of Ids to assign to the spawned Clusters, when the default id scheme is not wanted. */
	clusterList: number[];
	/** Options to pass to the spawn, respawn method. */
	spawnOptions: Required<ClusterSpawnOptions>;
	/** Heartbeat options. */
	heartbeat: Required<ClusterHeartbeatOptions>;
}

/** Data of ClusterClient. */
export interface ClusterClientData {
	/** List of shards that are assigned to this cluster. */
	ShardList: number[];
	/** The total amount of shards. */
	TotalShards: number;
	/** The total amount of clusters. */
	ClusterCount: number;
	/** The id of the cluster. */
	ClusterId: number;
	/** Mode of the manager. */
	ClusterManagerMode: ClusteringMode;
	/** Mode of the queue. */
	ClusterQueueMode?: 'auto' | 'manual';
	/** First shard id of the cluster. */
	FirstShardId: number;
	/** Last shard id of the cluster. */
	LastShardId: number;
}

/** Spawn options for the cluster. */
export interface ClusterSpawnOptions {
	/** How long to wait between spawning each cluster. */
	delay?: number;
	/** How long to wait for a cluster to become ready before killing it and retrying. */
	timeout?: number;
}

/** Data for the heartbeat system. */
export interface ClusterHeartbeatOptions {
	/** Whether the heartbeat system is enabled. */
	enabled: boolean;
	/** Maximum amount of missed heartbeats a cluster can have in the interval. */
	maxMissedHeartbeats?: number;
	/** Maximum amount of restarts a cluster can have in the interval. */
	maxRestarts?: number;
	/** Interval in milliseconds between each heartbeat. */
	interval?: number;
	/** Timeout in milliseconds after which a cluster will be considered as unresponsive. */
	timeout?: number;
}

/** Options for the queue. */
export interface QueueOptions {
	/** Whether the spawn queue be automatically managed. */
	mode?: 'auto' | 'manual';
	/** Time to wait until next item. */
	timeout?: number;
}

/** Kill options for the cluster. */
export interface ClusterKillOptions {
	/** The reason for killing the cluster. */
	reason: string;
}

/** Eval options for the cluster. */
export interface EvalOptions<T extends object = object> {
	/** Only run the script in a single cluster or set of clusters. */
	cluster?: number | number[];
	/** On what shard to run the script. */
	shard?: number | number[];
	/** On what guild to run the script. */
	guildId?: string;
	/** Context to use for the script. */
	context?: T;
	/** Timeout before the script is cancelled. */
	timeout?: number;
	/** Whether to continue running the script even if one of the clusters returns an error. */
	useAllSettled?: boolean;
}

/** Mode for reclustering. */
export type ReClusterRestartMode = 'gracefulSwitch' | 'rolling';

/** Options for reclustering. */
export interface ReClusterOptions {
	/** The new totalShards of the bot. */
	totalShards?: number;
	/** The amount of totalClusters to spread the shards over all clusters. */
	totalClusters?: number;
	/** The amount of shards per cluster. */
	shardsPerClusters?: number;

	/** The restartMode of the clusterManager, gracefulSwitch = waits until all new clusters have spawned, rolling = once the Cluster is ready, the old cluster will be killed. */
	restartMode?: ReClusterRestartMode;
}

/** Options for storing promises. */
export interface StoredPromise {
	/** Timeout before promise is canceled. */
	timeout?: NodeJS.Timer;

	/** Resolves the promise. */
	resolve(value: unknown): void;
	/** Return an error if failed. */
	reject(error: Error): void;
}

/** Events that manager emits. */
export interface ClusterManagerEvents {
	/** Emits when client sends a request via IPC. */
	clientRequest: [message: ProcessMessage];
	/** Emits when cluster is created. */
	clusterCreate: [cluster: Cluster];
	/** Emits when cluster is ready. */
	clusterReady: [cluster: Cluster];
	/** Emits when any message is sent from IPC. */
	message: [message: ProcessMessage];
	/** Debug events. */
	debug: [debugMessage: string];
	/** When all manager's clsuters are ready. */
	ready: [manager: ClusterManager];
}

/** Events that cluster emits. */
export interface ClusterEvents {
	/** Emits when any message is sent from IPC. */
	message: [message: ProcessMessage];
	/** Emits when cluster dies. */
	death: [cluster: Cluster, thread: ChildProcess | Worker | null];
	/** Emits when cluster is spawned. */
	spawn: [cluster: Cluster, thread: ChildProcess | Worker | null];
	/** Emits when cluster is ready. */
	ready: [cluster: Cluster];
	/** Emits when debug message is sent. */
	debug: [message: string];
	/** Emits when there is an error. */
	error: [error: Error];
}

/** Events that cluster client emits. */
export interface ClusterClientEvents {
	/** Emits when all clusters are ready. */
	managerReady: [];
	/** Emits when message is sent from IPC. */
	message: [message: ProcessMessage];
	/** Emits when cluster is ready. */
	ready: [clusterClient: ClusterClient];
	/** Emits when debug message is sent. */
	debug: [message: string];
}
