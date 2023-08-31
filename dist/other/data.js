"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInfo = void 0;
const worker_threads_1 = require("worker_threads");
function getInfo() {
    const clusterMode = process.env.CLUSTER_MANAGER_MODE;
    if (clusterMode !== 'worker' && clusterMode !== 'process')
        throw new Error('NO_CLUSTER_MANAGER_MODE | ClusterManager Mode is not defined in the environment variables.');
    let data;
    if (clusterMode === 'process') {
        const shardList = [];
        for (const cl of process.env?.SHARD_LIST?.split(',') || []) {
            shardList.push(Number(cl));
        }
        data = {
            ShardList: shardList,
            TotalShards: Number(process.env.TOTAL_SHARDS),
            ClusterCount: Number(process.env.CLUSTER_COUNT),
            ClusterId: Number(process.env.CLUSTER),
            ClusterManagerMode: clusterMode,
            ClusterQueueMode: process.env.CLUSTER_QUEUE_MODE,
            FirstShardId: shardList[0],
            LastShardId: shardList[shardList.length - 1],
        };
    }
    else {
        data = {
            ShardList: worker_threads_1.workerData.SHARD_LIST,
            TotalShards: worker_threads_1.workerData.TOTAL_SHARDS,
            ClusterCount: worker_threads_1.workerData.CLUSTER_COUNT,
            ClusterId: worker_threads_1.workerData.CLUSTER,
            ClusterManagerMode: clusterMode,
            ClusterQueueMode: worker_threads_1.workerData.CLUSTER_QUEUE_MODE,
            FirstShardId: worker_threads_1.workerData.SHARD_LIST[0],
            LastShardId: worker_threads_1.workerData.SHARD_LIST[worker_threads_1.workerData.SHARD_LIST.length - 1],
        };
    }
    return data;
}
exports.getInfo = getInfo;
//# sourceMappingURL=data.js.map