/// <reference types="node" />
import { ClusterClientEvents, EvalOptions, Serialized, Awaitable } from '../types';
import { ClientOptions, Client as DiscordClient, Guild } from 'discord.js';
import { BaseMessage, DataType } from '../other/message';
import { PromiseHandler } from '../handlers/promise';
import { ClusterManager } from './clusterManager';
import { Serializable } from 'child_process';
import EventEmitter from 'events';
export declare class ShardingClient extends DiscordClient {
    cluster: ClusterClient<this>;
    constructor(options: ClientOptions);
}
export declare class ClusterClient<InternalClient extends ShardingClient = ShardingClient> extends EventEmitter {
    client: InternalClient;
    ready: boolean;
    maintenance: string;
    promise: PromiseHandler;
    private process;
    private messageHandler;
    constructor(client: InternalClient);
    get id(): number;
    get shards(): import("@discordjs/collection").Collection<number, import("discord.js").WebSocketShard>;
    get totalShards(): number;
    get totalClusters(): number;
    get info(): import("../types").ClusterClientData;
    send(message: Serializable): Promise<void> | undefined;
    _sendInstance(message: BaseMessage<DataType>): Promise<void> | undefined;
    evalOnManager<T, P>(script: string | ((manager: ClusterManager, context: Serialized<P>) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<T extends never ? unknown : Serialized<T>>;
    broadcastEval<T, P>(script: string | ((client: InternalClient, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<(T extends never ? unknown : Serialized<T>)[]>;
    evalOnGuild<T, P>(guildId: string, script: string | ((client: InternalClient, context: Serialized<P>, guild: Guild) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<T extends never ? unknown : Serialized<T>>;
    evalOnClient<T, P>(script: string | ((client: InternalClient, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<T extends never ? unknown : Serialized<T>>;
    request<O>(message: Serializable, options?: {
        timeout?: number;
    }): Promise<Serialized<O>>;
    respawnAll(options?: {
        clusterDelay?: number;
        respawnDelay?: number;
        timeout?: number;
    }): Promise<void>;
    private _handleMessage;
    _respond<T extends DataType, D extends (Serializable | unknown) = Serializable>(type: T, message: BaseMessage<T, D>): void;
    triggerReady(): boolean;
    triggerMaintenance(maintenance: string, all?: boolean): string;
    spawnNextCluster(): Promise<void> | undefined;
}
export interface ClusterClient {
    emit: (<K extends keyof ClusterClientEvents>(event: K, ...args: ClusterClientEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, ...args: unknown[]) => boolean);
    off: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    on: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    once: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    removeAllListeners: (<K extends keyof ClusterClientEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterClientEvents>) => this);
}
