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
	/** Clusters currently being checked to avoid overlapping checks. */
	private readonly processing: Set<number>;

	/** Creates an instance of HeartbeatManager. */
	constructor (private readonly manager: ClusterManager) {
		if (this.manager.options.heartbeat.interval <= 0) throw new Error('The heartbeat interval must be greater than 0.');
		else if (this.manager.options.heartbeat.timeout <= 0) throw new Error('The heartbeat timeout must be greater than 0.');
		else if (this.manager.options.heartbeat.interval >= this.manager.options.heartbeat.timeout) throw new Error('The heartbeat timeout must be greater than the heartbeat interval.');
		else if (this.manager.options.heartbeat.timeout < this.manager.options.heartbeat.interval * 2) this.manager._debug('Warning: The heartbeat timeout is less than 2x the interval. This may lead to false positives.');
		else if (this.manager.options.heartbeat.maxMissedHeartbeats < 4) this.manager._debug('Warning: maxMissedHeartbeats is set to less than 4. Consider increasing it to avoid premature restarts.');

		this.beats = new Map();
		this.processing = new Set();
		this.interval = setInterval(() => {
			for (const cluster of this.manager.clusters.values()) {
				if (this.processing.has(cluster.id)) continue;
				this.processing.add(cluster.id);

				void this.checkCluster(cluster).catch((error) => {
					this.manager._debug(`[Heartbeat] Failed while checking cluster ${cluster.id}: ${(error as Error).message}`);
				}).finally(() => {
					this.processing.delete(cluster.id);
				});
			}
		}, this.manager.options.heartbeat.interval) as NodeJS.Timeout;
	}

	private async checkCluster(cluster: Cluster): Promise<void> {
		const clusterData = this.getClusterStats(cluster.id);
		if (clusterData.killing) return;

		if (cluster.ready && !this.isClusterProcessAlive(cluster)) {
			await this.handleCrashedCluster(cluster.id);
			return;
		}

		if (!cluster.ready) {
			if (!cluster.exited || cluster.respawning || !cluster.lastHeartbeatReceived) return;
			if (!this.manager.options.respawn) return;

			const elapsed = Date.now() - cluster.lastHeartbeatReceived;
			if (elapsed <= this.manager.options.heartbeat.timeout) return;

			this.manager._debug(`[Cluster ${cluster.id}] Cluster exited and remained unresponsive for ${elapsed}ms, counting missed heartbeat.`);
			await this.addMissedBeat(cluster.id);
			return;
		}

		if (!cluster.lastHeartbeatReceived) {
			cluster.lastHeartbeatReceived = Date.now();
			return;
		}

		this.manager._debug(
			`[Cluster ${cluster.id}] Heartbeat check ` +
			`(${ShardingUtils.boolProp(cluster.ready, 'ready')}, ` +
			`${ShardingUtils.boolProp(cluster.exited, 'exited')}, ` +
			`${ShardingUtils.boolProp(clusterData.killing, 'killing')}, ` +
			`${ShardingUtils.relativeTime(cluster.lastHeartbeatReceived)})`,
		);

		try {
			await cluster._sendInstance({ _type: MessageTypes.Heartbeat } as BaseMessage<'heartbeat'>);
		} catch (error) {
			this.manager._debug(`[Cluster ${cluster.id}] Failed to send heartbeat ping: ${(error as Error).message}`);
			await this.addMissedBeat(cluster.id);
			return;
		}

		if (Date.now() - cluster.lastHeartbeatReceived > this.manager.options.heartbeat.timeout) {
			this.manager._debug(`[Cluster ${cluster.id}] Missed a heartbeat ack. (${clusterData.missedBeats} missed)`);
			await this.addMissedBeat(cluster.id);
			return;
		}

		if (clusterData.missedBeats > 0) {
			clusterData.missedBeats = 0;
			this.beats.set(cluster.id, clusterData);
		}

		this.manager._debug(`[Cluster ${cluster.id}] Heartbeat ack received on time.`);
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

		if (targetCluster?.respawning) return;
		if (!this.manager.options.respawn) {
			this.manager._debug(`Cluster ${id} missed heartbeat but respawn is disabled.`);
			return;
		}

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
			if (!targetCluster) return;

			this.beats.set(id, { ...cluster, killing: true });
			this.manager._debug(
				`Cluster ${id} exceeded max missed heartbeats (${cluster.missedBeats}). ` +
				`Initiating restart (attempt ${cluster.restarts + 1})`,
			);

			if (cluster.restarts < this.manager.options.heartbeat.maxRestarts || this.manager.options.heartbeat.maxRestarts === -1) {
				const remaining = this.manager.options.heartbeat.maxRestarts !== -1
					? this.manager.options.heartbeat.maxRestarts - cluster.restarts
					: 'unlimited';

				this.manager._debug(`Restarting cluster ${id} (${remaining} restarts remaining)`);

				try {
					await targetCluster.respawn(this.manager.options.spawnOptions.delay, this.manager.options.spawnOptions.timeout);
					cluster.missedBeats = 0;
					cluster.restarts++;
				} catch (error) {
					this.manager._debug(`Failed to restart cluster ${id}: ${(error as Error).message}`);
				}
			} else {
				this.manager._debug(`Cluster ${id} reached maximum restarts (${cluster.restarts}). No longer restarting.`);
			}

			this.beats.set(id, { ...cluster, killing: false });
		}

		this.beats.set(id, cluster);
	}

	/** Check if cluster process/thread is actually alive. */
	private isClusterProcessAlive(cluster: Cluster): boolean {
		if (!cluster.thread?.process) return false;

		const process = cluster.thread.process;

		// Check child process
		if ('exitCode' in process && process.exitCode !== null) return false;
		if ('signalCode' in process && process.signalCode !== null) return false;

		// Check worker thread
		if ('threadId' in process && !process.threadId) return false;

		return true;
	}

	/** Handle detected crash */
	private async handleCrashedCluster(clusterId: number): Promise<void> {
		const cluster = this.manager.clusters.get(clusterId);
		if (!cluster || cluster.respawning) return;

		this.manager._debug(`[Heartbeat] Detected crashed cluster ${clusterId}`);

		cluster.ready = false;
		cluster.exited = true;
		cluster.thread = null;
		this.manager.ready = false;

		const clusterData = this.getClusterStats(clusterId);
		clusterData.missedBeats = 0;

		cluster.emit('death', cluster, null);
		if (!this.manager.options.respawn) return;

		if (clusterData.restarts < this.manager.options.heartbeat.maxRestarts || this.manager.options.heartbeat.maxRestarts === -1) {
			this.manager._debug(`[Heartbeat] Restarting crashed cluster ${clusterId} (${this.manager.options.heartbeat.maxRestarts !== -1 ? this.manager.options.heartbeat.maxRestarts - clusterData.restarts : 'unlimited'} restarts left)`);

			clusterData.restarts++;
			this.beats.set(clusterId, clusterData);

			try {
				await cluster.respawn(this.manager.options.spawnOptions.delay, this.manager.options.spawnOptions.timeout);
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
