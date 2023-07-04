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
    'ClientBroadcastRequest' = 6,
    'ClientBroadcastResponse' = 7,
    'ClientBroadcastResponseError' = 8,
    'ClientRespawn' = 9,
    'ClientRespawnAll' = 10,
    'ClientMaintenance' = 11,
    'ClientMaintenanceEnable' = 12,
    'ClientMaintenanceDisable' = 13,
    'ClientMaintenanceAll' = 14,
    'ClientSpawnNextCluster' = 15,
    'ClientReady' = 16,
    'ClientEvalRequest' = 17,
    'ClientEvalResponse' = 18,
    'ClientEvalResponseError' = 19,
    'ClientManagerEvalRequest' = 20,
    'ClientManagerEvalResponse' = 21,
    'ClientManagerEvalResponseError' = 22,
    'ManagerBroadcastRequest' = 23,
    'ManagerBroadcastResponse' = 24
}
export type Awaitable<T> = T | PromiseLike<T>;
export type ClusteringMode = 'worker' | 'process';
export type HeartbeatData = {
    restarts: number;
    missedBeats: number;
};
export type RequiredProps<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
export type Serialized<T> = T extends symbol | bigint | (() => unknown) ? never : T extends number | string | boolean | undefined ? T : T extends {
    toJSON(): infer R;
} ? R : T extends ReadonlyArray<infer V> ? Serialized<V>[] : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? object : T extends object ? {
    [K in keyof T]: Serialized<T[K]>;
} : T;
export interface ClusterManagerCreateOptions<T extends ClusteringMode> {
    mode?: T;
    token: string;
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
    customInstances?: ClusterManagerInstance[];
    autoLogin?: boolean;
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
    Maintenance?: string;
    ClusterQueueMode?: 'auto' | string | undefined;
    FirstShardId: number;
    LastShardId: number;
    AutoLogin: boolean;
    Token: string;
    DebugFull?: boolean;
}
export interface ClusterSpawnOptions {
    delay?: number;
    timeout?: number;
}
export interface ClusterManagerInstance {
    token: string;
    identifier?: string;
}
export interface ClusterHeartbeatOptions {
    maxMissedHeartbeats?: number;
    maxRestarts?: number;
    interval?: number;
    timeout?: number;
}
export interface QueueOptions {
    auto: boolean;
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
    debug: [debugMessage: string];
    ready: [manager: ClusterManager];
}
export interface ClusterEvents {
    message: [message: ProcessMessage];
    death: [cluster: Cluster, thread: ChildProcess | Worker | undefined | null];
    spawn: [thread: ChildProcess | Worker | undefined | null];
    error: [error: Error];
}
export interface ClusterClientEvents {
    message: [message: ProcessMessage];
    ready: [clusterClient: ClusterClient];
}
