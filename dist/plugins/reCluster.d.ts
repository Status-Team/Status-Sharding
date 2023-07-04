import { ClusterManager } from '../core/clusterManager';
import { ReClusterOptions } from '../types';
export declare class ReClusterManager {
    private manager;
    private inProgress;
    constructor(manager: ClusterManager);
    start(options: ReClusterOptions): Promise<boolean>;
}
