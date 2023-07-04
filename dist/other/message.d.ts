/// <reference types="node" />
import { ClusterClient } from '../core/clusterClient';
import { EvalOptions, MessageTypes } from '../types';
import { Serializable } from 'child_process';
import { Cluster } from '../core/cluster';
export type EvalMessage<P = object> = {
    options?: EvalOptions<P>;
    script: string;
};
export type RespawnMessage = {
    clusterDelay?: number;
    respawnDelay?: number;
    timeout?: number;
};
export type EvalResultMessage = unknown;
export type MaintenanceMessage = string;
export type DataType = 'normal' | 'eval' | 'respawn' | 'maintenance' | 'evalResult' | 'readyOrSpawn' | 'heartbeat' | 'error' | 'reply';
export type DataTypes<A = object> = {
    normal: A extends never ? Serializable : A;
    reply: DataTypes<A>['normal'];
    eval: EvalMessage<A>;
    readyOrSpawn: undefined;
    heartbeat: undefined;
    respawn: RespawnMessage;
    maintenance: MaintenanceMessage;
    evalResult: unknown;
    error: {
        message: string;
        stack?: string;
        name: string;
    };
};
export interface BaseMessage<D extends DataType, A extends (Serializable | unknown) = Serializable> {
    _type: MessageTypes;
    _nonce: string;
    data: DataTypes<A>[D];
}
export declare class ProcessMessage<T extends DataType = 'normal', A extends Serializable = Serializable> {
    private _instance;
    private _nonce;
    data: DataTypes<A>[T];
    constructor(instance: ClusterClient | Cluster, data: BaseMessage<T, A>);
    send(message: Serializable): Promise<void> | undefined;
    reply(message: Serializable): Promise<void>;
}
