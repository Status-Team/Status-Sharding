import { ClusterManager } from '../core/clusterManager';
import { HeartbeatData } from '../types';
export declare class HeartbeatManager {
    private readonly manager;
    private readonly interval;
    private readonly beats;
    constructor(manager: ClusterManager);
    stop(): void;
    getClusterStats(id: number): HeartbeatData;
    removeCluster(id: number, tryRespawn?: boolean): void;
    addMissedBeat(id: number): void;
}
