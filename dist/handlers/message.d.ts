/// <reference types="node" />
import { BaseMessage, DataType } from '../other/message';
import { ClusterClient, ShardingClient } from '../core/clusterClient';
import { Worker } from '../classes/worker';
import { Cluster } from '../core/cluster';
import { Child } from '../classes/child';
import { Serializable } from 'child_process';
export declare class ClusterHandler {
    private cluster;
    private ipc;
    constructor(cluster: Cluster, ipc: Worker | Child);
    handleMessage: <D extends DataType>(message: BaseMessage<D, Serializable>) => Promise<void>;
}
export declare class ClusterClientHandler<InternalClient extends ShardingClient = ShardingClient> {
    private clusterClient;
    constructor(clusterClient: ClusterClient<InternalClient>);
    handleMessage: (message: BaseMessage<DataType, unknown>) => Promise<void>;
}
