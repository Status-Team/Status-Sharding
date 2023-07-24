/// <reference types="node" />
/// <reference types="node" />
import { ClusterEvents, ClusterKillOptions, EvalOptions, Serialized, Awaitable } from '../types';
import { BaseMessage, DataType } from '../other/message';
import { ClusterManager } from './clusterManager';
import { ShardingClient } from './clusterClient';
import { Serializable } from 'child_process';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
export declare class Cluster extends EventEmitter {
    manager: ClusterManager;
    id: number;
    shardList: number[];
    ready: boolean;
    lastHeartbeatReceived: number;
    private thread;
    private messageHandler?;
    private envData;
    constructor(manager: ClusterManager, id: number, shardList: number[]);
    get totalShards(): number;
    get totalClusters(): number;
    spawn(spawnTimeout?: number): Promise<import("child_process").ChildProcess | import("worker_threads").Worker | null>;
    kill(options?: ClusterKillOptions): Promise<void>;
    respawn(delay?: number, timeout?: number): Promise<import("child_process").ChildProcess | import("worker_threads").Worker | null>;
    send(message: Serializable): Promise<void>;
    request<O>(message: Serializable, options?: {
        timeout?: number;
    }): Promise<Serialized<O>>;
    eval<T, P>(script: string | ((cluster: Cluster, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<T extends never ? unknown : Serialized<T>>;
    evalOnClient<T, P>(script: string | ((client: ShardingClient, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<(T extends never ? unknown : Serialized<T>)>;
    evalOnGuild<T, P>(guildId: string, script: string | ((client: ShardingClient, context: Serialized<P>, guild: Guild) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<T extends never ? unknown : Serialized<T>>;
    triggerMaintenance(reason?: string): Promise<void>;
    _sendInstance(message: BaseMessage<DataType>): Promise<void> | undefined;
    private _handleMessage;
    private _handleExit;
    private _handleError;
}
export interface Cluster {
    emit: (<K extends keyof ClusterEvents>(event: K, ...args: ClusterEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, ...args: unknown[]) => boolean);
    off: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
    on: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
    once: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
    removeAllListeners: (<K extends keyof ClusterEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterEvents>) => this);
}
