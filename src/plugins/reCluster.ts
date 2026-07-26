import { ClusterManager } from '../core/clusterManager';
import { ShardingUtils } from '../other/shardingUtils';
import { MessageTypes, ReClusterOptions } from '../types';
import { Cluster } from '../core/cluster';
import { BaseMessage } from '../other/message';

/** Handles re-clustering for the cluster manager. */
export class ReClusterManager {
	/** If re-clustering is in progress. */
	private inProgress: boolean = false;

	/** Creates an instance of ReClusterManager. */
	constructor (private readonly manager: ClusterManager) { }

	/** Whether a re-clustering operation is active. */
	public get active(): boolean {
		return this.inProgress;
	}

	/** Starts re-clustering. */
	public async start(options: ReClusterOptions): Promise<boolean> {
		if (this.inProgress) throw new Error('RECLUSTER_IN_PROGRESS | ReClustering is already in progress.');
		else if (!this.manager.ready) throw new Error('CLUSTER_MANAGER_NOT_READY | All clusters must be ready before re-clustering.');

		const restartMode = options.restartMode || 'gracefulSwitch';

		this.inProgress = true;
		this.manager.ready = false;
		this.manager._debug(`[ReClustering] Starting re-clustering in "${restartMode}" mode.`);

		try {
			const targetTotalShards = Math.max(1, options.totalShards ?? this.manager.options.totalShards);
			let targetTotalClusters = Math.max(1, options.totalClusters ?? this.manager.options.totalClusters);
			let targetShardsPerClusters = Math.max(1, options.shardsPerClusters ?? Math.ceil(targetTotalShards / targetTotalClusters));

			if (targetShardsPerClusters > targetTotalShards) targetShardsPerClusters = targetTotalShards;

			const shardList = Array.from({ length: targetTotalShards }, (_, i) => i);
			const listOfShardsForCluster = ShardingUtils.chunkArray(shardList, targetShardsPerClusters);
			targetTotalClusters = listOfShardsForCluster.length;

			const existingClusterIds = Array.from(this.manager.clusters.keys()).sort((a, b) => a - b);
			const clusterList = Array.from({ length: targetTotalClusters }, (_, i) => existingClusterIds[i] ?? i);

			this.manager.options.totalShards = targetTotalShards;
			this.manager.options.totalClusters = targetTotalClusters;
			this.manager.options.shardsPerClusters = targetShardsPerClusters;
			this.manager.options.shardList = shardList;
			this.manager.options.clusterList = clusterList;

			const newClusters: Map<number, Cluster> = new Map();
			const oldClusters: Map<number, Cluster> = new Map();

			for (const cluster of this.manager.clusters.values()) oldClusters.set(cluster.id, cluster);

			for (let i = 0; i < targetTotalClusters; i++) {
				const clusterId = clusterList[i] ?? i;
				const shards = listOfShardsForCluster[i] || [];
				const shardLength = Math.max(1, shards.length);
				const configuredTimeout = this.manager.options.spawnOptions.timeout;
				const delayPerShard = this.manager.options.spawnOptions.delay || 8000;
				const spawnTimeout = configuredTimeout === -1
					? Math.max(30000, delayPerShard * shardLength)
					: configuredTimeout + delayPerShard * shardLength;

				const cluster = this.manager.createCluster(clusterId, shards, true);
				newClusters.set(clusterId, cluster);

				this.manager._debug(`[ReClustering] [Cluster ${clusterId}] Spawning cluster with shards [${shards.join(', ')}].`);
				await cluster.spawn(spawnTimeout);
				this.manager._debug(`[ReClustering] [Cluster ${clusterId}] Cluster ready.`);

				if (restartMode === 'rolling') {
					const oldCluster = oldClusters.get(clusterId);
					if (oldCluster) {
						await oldCluster.kill({ reason: 'reClustering' });
						oldClusters.delete(clusterId);
						this.manager.clusters.delete(clusterId);
					}

					this.manager.clusters.set(clusterId, cluster);
					this.manager._debug(`[ReClustering] [Cluster ${clusterId}] Switched old cluster to new cluster.`);
				}

				if (i < targetTotalClusters - 1) await ShardingUtils.delayFor(delayPerShard * shardLength);
			}

			if (oldClusters.size) {
				this.manager._debug('[ReClustering] Killing remaining old clusters.');

				for (const [id, cluster] of oldClusters) {
					await cluster.kill({ reason: 'ReClustering is in progress.' });
					this.manager.clusters.delete(id);
					this.manager._debug(`[ReClustering] [Cluster ${id}] Killed old cluster.`);
				}
			}

			if (restartMode !== 'rolling') {
				for (const [id, cluster] of newClusters) {
					this.manager.clusters.set(id, cluster as unknown as Cluster);
					this.manager._debug(`[ReClustering] [Cluster ${id}] Switched old cluster to new cluster.`);
				}
			}

			this.manager.ready = this.manager.clusters.size === targetTotalClusters
				&& Array.from(this.manager.clusters.values()).every((cluster) => cluster.ready);

			if (this.manager.ready) {
				this.manager.emit('ready', this.manager);
				for (const cluster of this.manager.clusters.values()) {
					void cluster._sendInstance({ _type: MessageTypes.ManagerReady } as BaseMessage<'readyOrSpawn'>).catch((error) => {
						this.manager._debug(`[ReClustering] Failed to notify cluster ${cluster.id}: ${(error as Error).message}`);
					});
				}
			}
			this.manager._debug('[ReClustering] Finished re-clustering.');
			return true;
		} finally {
			this.inProgress = false;
		}
	}
}
