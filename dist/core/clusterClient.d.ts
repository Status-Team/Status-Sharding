/// <reference types="node" />
import { ClusterClientEvents, EvalOptions, Serialized, Awaitable, ValidIfSerializable, SerializableInput } from '../types';
import { BaseMessage, DataType } from '../other/message';
import { ClientOptions, Client as DiscordClient, Guild, ClientEvents } from 'discord.js';
import { IPCBrokerClient } from '../handlers/broker';
import { PromiseHandler } from '../handlers/promise';
import { ClusterManager } from './clusterManager';
import { WorkerClient } from '../classes/worker';
import { ChildClient } from '../classes/child';
import { Serializable } from 'child_process';
import EventEmitter from 'events';
export type ClientEventsModifiable = Omit<ClientEvents, 'ready'> & {
    ready: [client: ShardingClient];
};
export declare class ShardingClient extends DiscordClient {
    cluster: ClusterClient<this>;
    constructor(options: ClientOptions);
    on<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
    on<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
    once<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
    once<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
    off<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
    off<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
    emit<K extends keyof ClientEventsModifiable>(event: K, ...args: ClientEventsModifiable[K]): boolean;
    emit<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, ...args: unknown[]): boolean;
}
export declare class ClusterClient<InternalClient extends ShardingClient = ShardingClient> extends EventEmitter {
    client: InternalClient;
    ready: boolean;
    maintenance: string;
    promise: PromiseHandler;
    readonly broker: IPCBrokerClient;
    readonly process: ChildClient | WorkerClient | null;
    private messageHandler;
    constructor(client: InternalClient);
    get id(): number;
    get totalShards(): number;
    get totalClusters(): number;
    get info(): import("../types").ClusterClientData;
    send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void>;
    broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf?: boolean): Promise<void>;
    _sendInstance(message: BaseMessage<DataType>): Promise<void>;
    evalOnManager<T, P extends object, M = ClusterManager>(script: string | ((manager: M, context: Serialized<P>) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<ValidIfSerializable<T>>;
    broadcastEval<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>[]>;
    evalOnGuild<T, P extends object, C = InternalClient>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild?: Guild) => Awaitable<T>), options?: {
        context?: P;
        timeout?: number;
    }): Promise<ValidIfSerializable<T>>;
    evalOnClient<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>>;
    request<T extends Serializable>(message: SerializableInput<T>, options?: {
        timeout?: number;
    }): Promise<ValidIfSerializable<T>>;
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
export declare interface ClusterClient {
    emit: (<K extends keyof ClusterClientEvents>(event: K, ...args: ClusterClientEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, ...args: unknown[]) => boolean);
    off: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    on: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    once: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    removeAllListeners: (<K extends keyof ClusterClientEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterClientEvents>) => this);
}
