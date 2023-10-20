import { EvalOptions, MessageTypes, SerializableInput, Serializable } from '../types';
import { ClusterClient } from '../core/clusterClient';
import { Cluster } from '../core/cluster';
export type EvalMessage<P extends object = object> = {
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
export type DataTypes<A = object, P extends object = object> = {
    normal: A extends never ? Serializable : A;
    reply: DataTypes<A, P>['normal'];
    eval: EvalMessage<P>;
    readyOrSpawn: undefined;
    heartbeat: undefined;
    respawn: RespawnMessage;
    maintenance: MaintenanceMessage;
    evalResult: EvalResultMessage;
    error: {
        message: string;
        stack?: string;
        name: string;
    };
};
export type BaseMessage<D extends DataType, A extends (Serializable | unknown) = Serializable, P extends object = object> = {
    _type: MessageTypes;
    _nonce: string;
    data: DataTypes<A, P>[D];
};
export type BaseMessageInput<D extends DataType, A extends Serializable = Serializable> = Omit<BaseMessage<D, A>, '_nonce'>;
export declare class ProcessMessage<T extends DataType = 'normal', A extends Serializable = Serializable> {
    private _instance;
    private _nonce;
    data: DataTypes<A, object>[T];
    constructor(instance: ClusterClient | Cluster, data: BaseMessage<T, A>);
    reply<T extends Serializable>(message: SerializableInput<T>): Promise<void>;
}
