import { ClusterManager } from '../core/clusterManager';
import { ShardingUtils } from '../other/shardingUtils';
import { ReClusterOptions } from '../types';
import { Cluster } from '../core/cluster';

/**
 * Handles re-clustering for the cluster manager.
 * @export
 * @class ReClusterManager
 * @typedef {ReClusterManager}
 */
export class ReClusterManager {
	/**
	 * If re-clustering is in progress.
	 * @private
	 * @type {boolean}
	 */
	private inProgress: boolean = false;

	/**
	 * Creates an instance of ReClusterManager.
	 * @constructor
	 * @param {ClusterManager} manager - The cluster manager.
	 */
	constructor(private readonly manager: ClusterManager) {}

	/**
	 * Starts re-clustering.
	 * @async
	 * @param {ReClusterOptions} options - The options for re-clustering.
	 * @returns {Promise<boolean>} If re-clustering was successful.
	 */
	public async start(options: ReClusterOptions): Promise<boolean> {
		if (this.inProgress) throw new Error('RECLUSTER_IN_PROGRESS | ReClustering is already in progress.');
		else if (!this.manager.ready) throw new Error('CLUSTER_MANAGER_NOT_READY | All clusters must be ready before re-clustering.');

		if (!options.restartMode) options.restartMode = 'gracefulSwitch';

		this.inProgress = true;
		this.manager.triggerMaintenance('Reclustering..');
		this.manager._debug('[ReClustering] Enabling Maintenance Mode on all clusters.');

		const listOfShardsForCluster = ShardingUtils.chunkArray(this.manager.options.shardList || [], this.manager.options.shardsPerClusters || this.manager.options.totalShards);

		const newClusters: Map<number, Cluster> = new Map();
		const oldClusters: Map<number, Cluster> = new Map();

		for (const cf of this.manager.clusters.values()) oldClusters.set(cf.id, cf);

		for (let i = 0; i < this.manager.options.totalClusters; i++) {
			const length = listOfShardsForCluster[i]?.length || this.manager.options.totalShards / this.manager.options.totalClusters;
			const clusterId = this.manager.options.clusterList[i] || i;

			this.manager.clusterQueue.add({
				args: [this.manager.options.spawnOptions.timeout !== -1 ? this.manager.options.spawnOptions.timeout + this.manager.options.spawnOptions.delay * length : this.manager.options.spawnOptions.timeout],
				timeout: (this.manager.options.spawnOptions.delay || 8000) * length,
				run: async (...a: number[]) => {
					if (!this.manager) throw new Error('Manager is missing on ReClusterManager (#1).');

					const cluster = this.manager.createCluster(clusterId, listOfShardsForCluster[i], true);
					newClusters.set(clusterId, cluster);

					this.manager._debug(`[ReClustering] [Cluster ${clusterId}] Spawning Cluster.`);
					const c = await cluster.spawn(...a);

					if (!this.manager) throw new Error('Manager is missing on ReClusterManager (#2).');
					this.manager._debug(`[ReClustering] [Cluster ${clusterId}] Cluster Ready.`);

					if (options.restartMode === 'rolling') {
						const oldCluster = this.manager.clusters.get(clusterId);
						if (oldCluster) {
							oldCluster.kill({ reason: 'reClustering' });
							oldClusters.delete(clusterId);
						}

						this.manager.clusters.set(clusterId, cluster);
						this.manager._debug(`[ReClustering] [Cluster ${clusterId}] Switched OldCluster to NewCluster and exited Maintenance Mode.`);
						cluster.triggerMaintenance(undefined);
					}

					return c;
				},
			});
		}

		await this.manager.clusterQueue.start();

		if (oldClusters.size) {
			this.manager._debug('[ReClustering] Killing old clusters.');

			for (const [id, cluster] of Array.from(oldClusters)) {
				cluster.kill({ reason: 'ReClustering is in progress.' });

				this.manager._debug(`[ReClustering] [Cluster ${id}] Killed old cluster.`);
				this.manager.clusters.delete(id);
			}

			oldClusters.clear();
		}

		if (options.restartMode === 'rolling') {
			this.manager._debug('[ReClustering] Starting exiting Maintenance Mode on all clusters and killing old clusters.');

			for (let i = 0; i < this.manager.options.totalClusters; i++) {
				const clusterId = this.manager.options.clusterList[i] || i;
				const cluster = newClusters.get(clusterId);
				const oldCluster = this.manager.clusters.get(clusterId);

				if (!cluster) continue;
				if (oldCluster) {
					oldCluster.kill({ reason: 'reClustering' });
					oldClusters.delete(clusterId);
				}

				this.manager.clusters.set(clusterId, cluster); cluster.triggerMaintenance();
				this.manager._debug(`[ReClustering] [Cluster ${clusterId}] Switched OldCluster to NewCluster and exited Maintenance Mode.`);
			}
		}

		newClusters.clear();
		this.inProgress = false;
		process.env.MAINTENANCE = undefined;

		this.manager._debug('[ReClustering] Finished ReClustering.');
		return true;
	}
}
