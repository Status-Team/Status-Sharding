import { ClusterManager } from '../core/clusterManager';
import { ClusterClient } from '../core/clusterClient';
export type BrokerMessageHandler<T = unknown> = (message: T) => void;
export declare class IPCBroker {
    readonly instance: ClusterManager | ClusterClient;
    private listeners;
    constructor(instance: ClusterManager | ClusterClient);
    send<T>(channelName: string, message: T): Promise<void>;
    listen<T>(channelName: string, callback: BrokerMessageHandler<T>): void;
    handleMessage({ _data, broker }: {
        _data: unknown;
        broker: string;
    }): void;
}
