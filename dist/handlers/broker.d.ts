import { Serializable, SerializableInput } from '../types';
import { ClusterManager } from '../core/clusterManager';
import { ClusterClient } from '../core/clusterClient';
export type BrokerMessage = {
    _data: unknown;
    broker: string;
};
export type BrokerMessageHandler<T = unknown> = (message: T) => void;
declare abstract class IPCBrokerAbstract {
    readonly instance: ClusterManager | ClusterClient;
    private listeners;
    constructor(instance: ClusterManager | ClusterClient);
    listen<T>(channelName: string, callback: BrokerMessageHandler<T>): void;
    handleMessage({ _data, broker }: BrokerMessage): void;
}
export declare class IPCBrokerManager extends IPCBrokerAbstract {
    send<T extends Serializable>(channelName: string, message: SerializableInput<T>, clusterId?: number): Promise<void>;
}
export declare class IPCBrokerClient extends IPCBrokerAbstract {
    send<T extends Serializable>(channelName: string, message: SerializableInput<T>): Promise<void>;
}
export {};
