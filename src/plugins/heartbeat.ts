import { ClusterManager } from '../core/clusterManager';
import { HeartbeatData, MessageTypes } from '../types';
import { BaseMessage } from '../other/message';

/**
 * Handles heartbeats for the cluster manager.
 * @export
 * @class HeartbeatManager
 * @typedef {HeartbeatManager}
 */
export class HeartbeatManager {
	/**
	 * The interval of the heartbeat.
	 * @private
	 * @readonly
	 * @type {NodeJS.Timeout}
	 */
	private readonly interval: NodeJS.Timeout;
	/**
	 * The list of heartbeat data per cluster.
	 * @private
	 * @readonly
	 * @type {Map<number, HeartbeatData>}
	 */
	private readonly beats: Map<number, HeartbeatData>;

	/**
	 * Creates an instance of HeartbeatManager.
	 * @constructor
	 * @param {ClusterManager} manager - The instance of the cluster manager.
	 */
	constructor(private readonly manager: ClusterManager) {
		this.beats = new Map();
		this.interval = setInterval(() => {
			for (const cluster of this.manager.clusters.values()) {
				if (!cluster.ready) continue; cluster._sendInstance({
					_type: MessageTypes.Heartbeat,
				} as BaseMessage<'heartbeat'>)?.catch(() => null);
			}
		}, this.manager.options.heartbeat.interval || 30000); // 30 seconds
	}

	/**
	 * Stops the heartbeat.
	 * @returns {void} Nothing.
	 */
	public stop(): void {
		clearInterval(this.interval);
	}

	/**
	 * Gets the heartbeat data for a cluster.
	 * @param {number} id - The id of the cluster.
	 * @returns {HeartbeatData} The heartbeat data.
	 */
	public getClusterStats(id: number): HeartbeatData {
		return this.beats.get(id) || this.beats.set(id, { missedBeats: 0, restarts: 0 }).get(id) as HeartbeatData;
	}

	/**
	 * Removes a cluster from the heartbeat.
	 * @param {number} id - The id of the cluster.
	 * @param {boolean} [tryRespawn=true] - Whether to try to respawn the cluster.
	 * @returns {void} Nothing.
	 */
	public removeCluster(id: number, tryRespawn: boolean = true): void {
		const cluster = this.getClusterStats(id);
		this.beats.delete(id);

		if (tryRespawn) {
			if (cluster.restarts < this.manager.options.heartbeat.maxRestarts) {
				this.manager._debug(`Cluster ${id} is restarting... (${this.manager.options.heartbeat.maxRestarts - cluster.restarts} left.)`);
				this.manager.clusters.get(id)?.spawn();

				cluster.missedBeats = 0;
				cluster.restarts++;

				this.beats.set(id, cluster);
			} else this.manager._debug(`Cluster ${id} reached the maximum amount of restarts. (${cluster.restarts})`);
		}
	}

	/**
	 * Adds a missed beat to a cluster.
	 * @param {number} id - The id of the cluster.
	 * @returns {void} Nothing.
	 */
	public addMissedBeat(id: number): void {
		const cluster = this.getClusterStats(id);
		cluster.missedBeats++;

		if (cluster.missedBeats > this.manager.options.heartbeat.maxMissedHeartbeats) {
			this.manager.clusters.get(id)?.kill({ reason: 'Missed too many heartbeats.' });
			this.manager._debug(`Cluster ${id} has missed too many heartbeats. (${cluster.missedBeats})`);

			if (cluster.restarts < this.manager.options.heartbeat.maxRestarts) {
				this.manager._debug(`Cluster ${id} is restarting... (${this.manager.options.heartbeat.maxRestarts - cluster.restarts} left.)`);
				this.manager.clusters.get(id)?.spawn();

				cluster.missedBeats = 0;
				cluster.restarts++;
			} else this.manager._debug(`Cluster ${id} reached the maximum amount of restarts. (${cluster.restarts})`);
		}

		this.beats.set(id, cluster);
	}
}
