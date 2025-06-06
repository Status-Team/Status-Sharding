import { ClusterManager } from '../core/clusterManager';
import { ShardingUtils } from '../other/shardingUtils';
import { HeartbeatData, MessageTypes } from '../types';
import { BaseMessage } from '../other/message';

/** Handles heartbeats for the cluster manager. */
export class HeartbeatManager {
	/** The interval of the heartbeat. */
	private readonly interval: NodeJS.Timeout;
	/** The list of heartbeat data per cluster. */
	private readonly beats: Map<number, HeartbeatData>;

	/** Creates an instance of HeartbeatManager. */
	constructor (private readonly manager: ClusterManager) {
		if (this.manager.options.heartbeat.interval <= 0) throw new Error('The heartbeat interval must be greater than 0.');
		else if (this.manager.options.heartbeat.timeout <= 0) throw new Error('The heartbeat timeout must be greater than 0.');
		else if (this.manager.options.heartbeat.interval >= this.manager.options.heartbeat.timeout) throw new Error('The heartbeat timeout must be greater than the heartbeat interval.');

		this.beats = new Map();
		this.interval = setInterval(() => {
			for (const cluster of this.manager.clusters.values()) {
				const shouldSend = cluster.ready ? true : cluster.exited;
				this.manager._debug(`Cluster ${cluster.id} heartbeat check (${ShardingUtils.boolProp(cluster.ready, 'ready')}, ${ShardingUtils.boolProp(cluster.exited, 'exited')}, ${ShardingUtils.boolProp(this.beats.get(cluster.id)?.killing, 'killing')}, ${ShardingUtils.relativeTime(cluster.lastHeartbeatReceived)})`);

				if ((!shouldSend && !this.beats.get(cluster.id)?.killing) || !cluster.lastHeartbeatReceived) continue;

				cluster._sendInstance({ _type: MessageTypes.Heartbeat } as BaseMessage<'heartbeat'>)?.catch(() => null);

				if (Date.now() - cluster.lastHeartbeatReceived > this.manager.options.heartbeat.timeout) {
					this.manager._debug(`Cluster ${cluster.id} has missed a heartbeat. (${this.getClusterStats(cluster.id).missedBeats} missed)`);
					this.addMissedBeat(cluster.id);
				} else {
					const clusterData = this.getClusterStats(cluster.id);
					if (clusterData.missedBeats > 0) {
						clusterData.missedBeats = 0;
						this.beats.set(cluster.id, clusterData);
					}

					this.manager._debug(`Cluster ${cluster.id} has received a heartbeat.`);
				}
			}
		}, this.manager.options.heartbeat.interval) as NodeJS.Timeout;
	}

	/** Stops the heartbeat. */
	public stop(): void {
		clearInterval(this.interval);
	}

	/** Gets the heartbeat data for a cluster. */
	public getClusterStats(id: number): HeartbeatData {
		return this.beats.get(id) || this.beats.set(id, { missedBeats: 0, restarts: 0, killing: false }).get(id) as HeartbeatData;
	}

	/** Removes a cluster from the heartbeat. */
	public removeCluster(id: number): void {
		this.beats.delete(id);
	}

	/** Adds a missed beat to a cluster. */
	private async addMissedBeat(id: number): Promise<void> {
		const cluster = this.getClusterStats(id);
		cluster.missedBeats++;

		if (cluster.missedBeats >= this.manager.options.heartbeat.maxMissedHeartbeats) {
			const targetCluster = this.manager.clusters.get(id);
			if (!targetCluster) throw new Error(`Cluster ${id} not found for heartbeat.`);

			this.beats.set(id, { ...cluster, killing: true });
			this.manager._debug(`Cluster ${id} has missed too many heartbeats. (${cluster.missedBeats})`);
			if (targetCluster.thread) await targetCluster?.kill({ reason: 'Missed too many heartbeats.' });
			this.beats.set(id, { ...cluster, killing: false });

			if (cluster.restarts < this.manager.options.heartbeat.maxRestarts || this.manager.options.heartbeat.maxRestarts !== -1) {
				this.manager._debug(`Cluster ${id} is restarting.. (${this.manager.options.heartbeat.maxRestarts !== -1 ? this.manager.options.heartbeat.maxRestarts - cluster.restarts : 'unlimited'} left)`);
				if (!targetCluster.thread) await targetCluster?.spawn();

				cluster.missedBeats = 0;
				cluster.restarts++;
			} else this.manager._debug(`Cluster ${id} reached the maximum amount of restarts (${cluster.restarts}).`);
		}

		this.manager._debug(`Cluster ${id} has missed a heartbeat. (${cluster.missedBeats} missed)`);
		this.beats.set(id, cluster);
	}
}
