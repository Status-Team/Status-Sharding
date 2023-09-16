/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { ClusterManager } from './core/clusterManager';
import { WorkerThreadOptions } from './classes/worker';
import { ChildProcessOptions } from './classes/child';
import { ClusterClient } from './core/clusterClient';
import { ProcessMessage } from './other/message';
import { ChildProcess } from 'child_process';
import { Cluster } from './core/cluster';
import { Worker } from 'worker_threads';
export declare const DefaultOptions: {
    http: {
        api: string;
        version: string;
    };
};
export declare const Endpoints: {
    botGateway: string;
};
export declare enum MessageTypes {
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
    'ClientMaintenance' = 12,
    'ClientMaintenanceEnable' = 13,
    'ClientMaintenanceDisable' = 14,
    'ClientMaintenanceAll' = 15,
    'ClientSpawnNextCluster' = 16,
    'ClientReady' = 17,
    'ClientEvalRequest' = 18,
    'ClientEvalResponse' = 19,
    'ClientEvalResponseError' = 20,
    'ClientManagerEvalRequest' = 21,
    'ClientManagerEvalResponse' = 22,
    'ClientManagerEvalResponseError' = 23
}
export type Awaitable<T> = T | PromiseLike<T>;
export type ClusteringMode = 'worker' | 'process';
export type UnknownFunction = (...args: unknown[]) => unknown;
export type HeartbeatData = {
    restarts: number;
    missedBeats: number;
};
export type RequiredProps<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
export type ValidIfSerializable<T> = T extends NonNullable<Serializable> ? (T | undefined) : never;
export type Serializable = string | number | boolean | null | undefined | Serializable[] | {
    [key: string]: Serializable;
};
export type Serialized<T> = T extends symbol | bigint | UnknownFunction ? never : T extends ValidIfSerializable<T> ? T : (T extends {
    toJSON(): infer R;
} ? R : T extends ReadonlyArray<infer V> ? Serialized<V>[] : (T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? object : (T extends object ? {
    [K in keyof T]: Serialized<T[K]>;
} : T)));
export interface ClusterManagerCreateOptions<T extends ClusteringMode> {
    mode?: T;
    token?: string;
    totalShards?: number;
    totalClusters?: number;
    shardsPerClusters?: number;
    shardArgs?: string[];
    execArgv?: string[];
    respawn?: boolean;
    heartbeat?: ClusterHeartbeatOptions;
    queueOptions?: QueueOptions;
    spawnOptions?: ClusterSpawnOptions;
    clusterData?: object;
    clusterOptions?: T extends 'worker' ? WorkerThreadOptions : ChildProcessOptions;
}
export interface ClusterManagerOptions<T extends ClusteringMode> extends ClusterManagerCreateOptions<T> {
    mode: T;
    totalShards: number;
    totalClusters: number;
    shardsPerClusters: number;
    shardList: number[];
    clusterList: number[];
    spawnOptions: Required<ClusterSpawnOptions>;
    heartbeat: Required<ClusterHeartbeatOptions>;
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
    maxMissedHeartbeats?: number;
    maxRestarts?: number;
    interval?: number;
    timeout?: number;
}
export interface QueueOptions {
    mode?: 'auto' | 'manual';
    timeout?: number;
}
export interface ClusterKillOptions {
    reason?: string;
    force: boolean;
}
export interface EvalOptions<T = object> {
    cluster?: number | number[];
    shard?: number | number[];
    guildId?: string;
    context?: T;
    timeout?: number;
}
export type ReClusterRestartMode = 'gracefulSwitch' | 'rolling';
export interface ReClusterOptions {
    totalShards?: number;
    totalClusters?: number;
    shardsPerClusters?: number;
    restartMode?: ReClusterRestartMode;
}
export interface StoredPromise {
    timeout?: NodeJS.Timeout;
    resolve(value: unknown): void;
    reject(error: Error): void;
}
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
