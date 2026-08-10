import type { ClusterManager } from '../core/clusterManager.js';
import type { ReClusterOptions } from '../types.js';

export class ReClusterManager {
	public active = false;

	constructor (private readonly manager: ClusterManager) { }

	public async start(options: ReClusterOptions = {}): Promise<boolean> {
		if (this.active) return false;
		this.active = true;

		try {
			const totalShards = options.totalShards ?? this.manager.options.totalShards;
			const configuredClusters = options.totalClusters ?? this.manager.options.totalClusters;
			const configuredShardsPerCluster = options.shardsPerClusters ?? this.manager.options.shardsPerClusters;
			
			if (!Number.isInteger(totalShards) || totalShards < 1) throw new RangeError('RECLUSTER_INVALID_OPTION | totalShards must be a positive integer.');
			if (!Number.isInteger(configuredClusters) || configuredClusters < 1) throw new RangeError('RECLUSTER_INVALID_OPTION | totalClusters must be a positive integer.');
			if (!Number.isInteger(configuredShardsPerCluster) || configuredShardsPerCluster < 1) throw new RangeError('RECLUSTER_INVALID_OPTION | shardsPerClusters must be a positive integer.');

			const totalClusters = Math.min(totalShards, Math.max(configuredClusters, Math.ceil(totalShards / configuredShardsPerCluster)));
			const shardsPerClusters = Math.ceil(totalShards / totalClusters);
			
			this.manager._debug(`The manager is re-clustering ${totalShards} shards across ${totalClusters} clusters.`);
			this.manager.ready = false;
			await Promise.all(
				Array.from(this.manager.clusters.values()).map((cluster) =>
					cluster.kill({ lifecycleReason: 'recluster', reason: 'Re-clustering.' }),
				),
			);
			
			for (const id of [...this.manager.clusters.keys()]) this.manager.clusters._deleteInternal(id);
			this.manager.options.totalShards = totalShards;
			this.manager.options.totalClusters = totalClusters;
			this.manager.options.shardsPerClusters = shardsPerClusters;
			this.manager.resetSpawnQueue();

			for (let id = 0; id < totalClusters; id += 1) {
				const start = id * shardsPerClusters;
				const shards = Array.from({ length: Math.min(shardsPerClusters, totalShards - start) }, (_, offset) => start + offset);
				if (shards.length) this.manager.createCluster(id, shards, true);
			}
			
			await this.manager.spawn();
			return true;
		} finally {
			this.active = false;
		}
	}
}
