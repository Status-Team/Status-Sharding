/// <reference types="node" />
import { Awaitable, ClusterManagerCreateOptions, ClusterManagerEvents, ClusterManagerOptions, ClusteringMode, EvalOptions, Serialized } from '../types';
import { Guild, Client as DiscordClient } from 'discord.js';
import { Serializable } from 'child_process';
import { HeartbeatManager } from '../plugins/heartbeat';
import { ReClusterManager } from '../plugins/reCluster';
import { PromiseHandler } from '../handlers/promise';
import { ShardingClient } from './clusterClient';
import { Queue } from '../handlers/queue';
import { Cluster } from './cluster';
import EventEmitter from 'events';
export declare class ClusterManager extends EventEmitter {
    file: string;
    ready: boolean;
    maintenance: string;
    readonly options: ClusterManagerOptions<ClusteringMode>;
    readonly promise: PromiseHandler;
    readonly clusters: Map<number, Cluster>;
    readonly reCluster: ReClusterManager;
    readonly heartbeat: HeartbeatManager;
    readonly clusterQueue: Queue;
    constructor(file: string, options: ClusterManagerCreateOptions<ClusteringMode>);
    spawn(): Promise<Queue>;
    broadcast(message: Serializable): Promise<void[]>;
    respawnAll({ clusterDelay, respawnDelay, timeout }: {
        clusterDelay?: number | undefined;
        respawnDelay?: number | undefined;
        timeout?: number | undefined;
    }): Promise<Map<number, Cluster>>;
    eval<T, P>(script: string | ((manager: ClusterManager, context: Serialized<P>) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<{
        result: Serialized<T> | undefined;
        error: Error | undefined;
    }>;
    broadcastEval<T, P>(script: string | ((client: ShardingClient, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<(T extends never ? unknown : Serialized<T>)[]>;
    broadcastEvalWithCustomInstances<T, P>(script: string | ((client: ShardingClient, context: Serialized<P>) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }, customInstances?: DiscordClient[]): Promise<{
        isCustomInstance: boolean;
        result: T extends never ? unknown : Serialized<T>;
    }[]>;
    evalOnClusterClient<T, P>(cluster: number, script: string | ((client: ShardingClient, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<T extends never ? unknown : Serialized<T>>;
    evalOnCluster<T, P>(cluster: number, script: string | ((cluster: Cluster, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<T extends never ? unknown : Serialized<T>>;
    evalOnGuild<T, P>(guildId: string, script: string | ((client: ShardingClient, context: Serialized<P>, guild: Guild) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<T extends never ? unknown : Serialized<T>>;
    createCluster(id: number, shardsToSpawn: number[], recluster?: boolean): Cluster;
    triggerMaintenance(reason: string): void;
    _debug(message: string): string;
}
export interface ClusterManager {
    emit: (<K extends keyof ClusterManagerEvents>(event: K, ...args: ClusterManagerEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, ...args: unknown[]) => boolean);
    off: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
    on: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
    once: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
    removeAllListeners: (<K extends keyof ClusterManagerEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterManagerEvents>) => this);
}
