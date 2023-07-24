import { ClusterManager } from '../core/clusterManager';
import { ReClusterOptions } from '../types';
export declare class ReClusterManager {
    private readonly manager;
    private inProgress;
    constructor(manager: ClusterManager);
    start(options: ReClusterOptions): Promise<boolean>;
}
