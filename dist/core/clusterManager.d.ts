import { Awaitable, ClusterManagerCreateOptions, ClusterManagerEvents, ClusterManagerOptions, ClusteringMode, EvalOptions, Serialized, ValidIfSerializable, Serializable, SerializableInput } from '../types';
import { HeartbeatManager } from '../plugins/heartbeat';
import { ReClusterManager } from '../plugins/reCluster';
import { IPCBrokerManager } from '../handlers/broker';
import { PromiseHandler } from '../handlers/promise';
import { ShardingClient } from './clusterClient';
import { Queue } from '../handlers/queue';
import { Cluster } from './cluster';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
export declare class ClusterManager extends EventEmitter {
    file: string;
    ready: boolean;
    maintenance: string;
    readonly broker: IPCBrokerManager;
    readonly options: ClusterManagerOptions<ClusteringMode>;
    readonly promise: PromiseHandler;
    readonly clusters: Map<number, Cluster>;
    readonly reCluster: ReClusterManager;
    readonly heartbeat: HeartbeatManager;
    readonly clusterQueue: Queue;
    constructor(file: string, options: ClusterManagerCreateOptions<ClusteringMode>);
    spawn(): Promise<Queue>;
    broadcast<T extends Serializable>(message: SerializableInput<T>, ignoreClusters?: number[]): Promise<void>;
    respawnAll({ clusterDelay, respawnDelay, timeout }: {
        clusterDelay?: number | undefined;
        respawnDelay?: number | undefined;
        timeout?: number | undefined;
    }): Promise<Map<number, Cluster>>;
    eval<T, P extends object, M = ClusterManager>(script: string | ((manager: M, context: Serialized<P>) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<{
        result: Serialized<T> | undefined;
        error: Error | undefined;
    }>;
    broadcastEval<T, P extends object, C = ShardingClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>[]>;
    evalOnClusterClient<T, P extends object, C = ShardingClient>(cluster: number, script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>>;
    evalOnCluster<T, P extends object>(cluster: number, script: string | ((cluster: Cluster, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>>;
    evalOnGuild<T, P extends object, C = ShardingClient>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild?: Guild) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<ValidIfSerializable<T>>;
    createCluster(id: number, shardsToSpawn: number[], recluster?: boolean): Cluster;
    triggerMaintenance(reason: string): void;
    _debug(message: string): string;
}
export declare interface ClusterManager {
    emit: (<K extends keyof ClusterManagerEvents>(event: K, ...args: ClusterManagerEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, ...args: unknown[]) => boolean);
    off: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
    on: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
    once: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
    removeAllListeners: (<K extends keyof ClusterManagerEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterManagerEvents>) => this);
}
