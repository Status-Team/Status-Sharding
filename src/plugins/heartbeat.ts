import { ClusterManager } from '../core/clusterManager';
import { ShardingUtils } from '../other/shardingUtils';
import { HeartbeatData, MessageTypes } from '../types';
import { BaseMessage } from '../other/message';
import { Cluster } from '../core/cluster';

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
		else if (this.manager.options.heartbeat.timeout < this.manager.options.heartbeat.interval * 2) this.manager._debug('Warning: The heartbeat timeout is less than 2x the interval. This may lead to false positives.');
		else if (this.manager.options.heartbeat.maxMissedHeartbeats < 4) this.manager._debug('Warning: maxMissedHeartbeats is set to less than 4. Consider increasing it to avoid premature restarts.');

		this.beats = new Map();
		this.interval = setInterval(() => {
			for (const cluster of this.manager.clusters.values()) {
				if (cluster.ready && !this.isClusterProcessAlive(cluster)) {
					this.handleCrashedCluster(cluster.id);
					continue;
				}

				const shouldSend = cluster.ready ? true : cluster.exited;
				if ((!shouldSend && !this.beats.get(cluster.id)?.killing) || !cluster.lastHeartbeatReceived) continue;

				this.manager._debug(
					`[Cluster ${cluster.id}] Heartbeat check ` +
					`(${ShardingUtils.boolProp(cluster.ready, 'ready')}, ` +
					`${ShardingUtils.boolProp(cluster.exited, 'exited')}, ` +
					`${ShardingUtils.boolProp(this.beats.get(cluster.id)?.killing, 'killing')}, ` +
					`${ShardingUtils.relativeTime(cluster.lastHeartbeatReceived)})`,
				);

				cluster._sendInstance({ _type: MessageTypes.Heartbeat } as BaseMessage<'heartbeat'>)?.catch(() => null);

				if (Date.now() - cluster.lastHeartbeatReceived > this.manager.options.heartbeat.timeout) {
					this.manager._debug(`[Cluster ${cluster.id}] Missed a heartbeat ack. (${this.getClusterStats(cluster.id).missedBeats} missed)`);
					this.addMissedBeat(cluster.id);
				} else {
					const clusterData = this.getClusterStats(cluster.id);
					if (clusterData.missedBeats > 0) {
						clusterData.missedBeats = 0;
						this.beats.set(cluster.id, clusterData);
					}

					this.manager._debug(`[Cluster ${cluster.id}] Heartbeat ack received on time.`);
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
		const targetCluster = this.manager.clusters.get(id);

		cluster.missedBeats++;

		const timeoutMs = this.manager.options.heartbeat.timeout;
		const lastHeartbeat = targetCluster?.lastHeartbeatReceived;
		const timeSinceLastBeat = lastHeartbeat ? Date.now() - lastHeartbeat : 'unknown';

		this.manager._debug(
			`Cluster ${id} missed heartbeat. ` +
			`(${cluster.missedBeats}/${this.manager.options.heartbeat.maxMissedHeartbeats} missed, ` +
			`timeout: ${timeoutMs}ms, last beat: ${timeSinceLastBeat}ms ago)`,
		);

		if (cluster.missedBeats >= this.manager.options.heartbeat.maxMissedHeartbeats) {
			if (!targetCluster) throw new Error(`Cluster ${id} not found for heartbeat.`);

			this.beats.set(id, { ...cluster, killing: true });
			this.manager._debug(
				`Cluster ${id} exceeded max missed heartbeats (${cluster.missedBeats}). ` +
				`Initiating restart (attempt ${cluster.restarts + 1})`,
			);

			if (targetCluster.thread) await targetCluster?.kill({ reason: 'Missed too many heartbeats.' });
			this.beats.set(id, { ...cluster, killing: false });

			if (cluster.restarts < this.manager.options.heartbeat.maxRestarts || this.manager.options.heartbeat.maxRestarts === -1) {
				const remaining = this.manager.options.heartbeat.maxRestarts !== -1
					? this.manager.options.heartbeat.maxRestarts - cluster.restarts
					: 'unlimited';

				this.manager._debug(`Restarting cluster ${id} (${remaining} restarts remaining)`);

				if (!targetCluster.thread) await targetCluster?.spawn();
				cluster.missedBeats = 0;
				cluster.restarts++;
			} else {
				this.manager._debug(`Cluster ${id} reached maximum restarts (${cluster.restarts}). No longer restarting.`);
			}
		}

		this.beats.set(id, cluster);
	}

	/** Check if cluster process/thread is actually aliv.e */
	private isClusterProcessAlive(cluster: Cluster): boolean {
		if (!cluster.thread?.process) return false;

		const process = cluster.thread.process;

		// Check child process
		if ('killed' in process && process.killed) return false;
		if ('exitCode' in process && process.exitCode !== null) return false;

		// Check worker thread
		if ('threadId' in process && !process.threadId) return false;

		return true;
	}

	/** Handle detected crash */
	private async handleCrashedCluster(clusterId: number): Promise<void> {
		const cluster = this.manager.clusters.get(clusterId);
		if (!cluster) return;

		this.manager._debug(`[Heartbeat] Detected crashed cluster ${clusterId}`);

		cluster.ready = false;
		cluster.exited = true;
		cluster.thread = null;

		const clusterData = this.getClusterStats(clusterId);
		clusterData.missedBeats = 0;

		cluster.emit('death', cluster, null);

		if (clusterData.restarts < this.manager.options.heartbeat.maxRestarts || this.manager.options.heartbeat.maxRestarts === -1) {
			this.manager._debug(`[Heartbeat] Restarting crashed cluster ${clusterId} (${this.manager.options.heartbeat.maxRestarts !== -1 ? this.manager.options.heartbeat.maxRestarts - clusterData.restarts : 'unlimited'} restarts left)`);

			clusterData.restarts++;
			this.beats.set(clusterId, clusterData);

			try {
				await cluster.spawn();
			} catch (err) {
				this.manager._debug(`[Heartbeat] Failed to respawn crashed cluster ${clusterId}: ${(err as Error).message}`);
			}
		} else {
			this.manager._debug(`[Heartbeat] Cluster ${clusterId} reached maximum restarts (${clusterData.restarts}), not restarting.`);
		}
	}

	public getHealthSummary(): { clusterId: number; status: string; missedBeats: number; restarts: number; }[] {
		const summary: { clusterId: number; status: string; missedBeats: number; restarts: number; }[] = [];

		for (const [clusterId, cluster] of this.manager.clusters) {
			const stats = this.getClusterStats(clusterId);

			summary.push({
				clusterId,
				status: cluster.ready ? 'healthy' : (cluster.exited ? 'exited' : 'starting'),
				missedBeats: stats.missedBeats,
				restarts: stats.restarts,
			});
		}

		return summary;
	}

}
