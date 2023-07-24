import { ClusterManager } from '../core/clusterManager';
import { HeartbeatData, MessageTypes } from '../types';
import { BaseMessage } from '../other/message';

export class HeartbeatManager {
	private readonly interval: NodeJS.Timeout;
	private readonly beats: Map<number, HeartbeatData>;

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

	public stop() {
		clearInterval(this.interval);
	}

	public getClusterStats(id: number): HeartbeatData {
		return this.beats.get(id) || this.beats.set(id, { missedBeats: 0, restarts: 0 }).get(id) as HeartbeatData;
	}

	public removeCluster(id: number, tryRespawn = true) {
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

	public addMissedBeat(id: number) {
		const cluster = this.getClusterStats(id);
		cluster.missedBeats++;

		if (cluster.missedBeats > this.manager.options.heartbeat.maxMissedHeartbeats) {
			this.manager.clusters.get(id)?.kill({ force: true });
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
