import type { ClusterManager } from '../core/clusterManager.js';
import { MessageTypes, type RefCluster } from '../types.js';
import { ShardingUtils } from '../other/shardingUtils.js';

export interface HeartbeatStats {
	restarts: number;
	missedHeartbeats: number;
	lastAckAt?: number;
	lastPingAt?: number;
}

export interface HeartbeatSummary extends HeartbeatStats {
	clusterId: number;
	status: 'healthy' | 'degraded' | 'stopped' | 'starting';
	missedBeats: number;
}

export class HeartbeatManager {
	private timer?: NodeJS.Timeout;
	private readonly pending = new Map<number, { nonce: string; sentAt: number }>();
	private readonly stats = new Map<number, HeartbeatStats>();
	private readonly failed = new Set<number>();

	constructor (private readonly manager: ClusterManager) { }

	public start(): void {
		if (!this.manager.options.heartbeat.enabled || this.timer) return;
		this.manager._debug(`The heartbeat monitor started with an interval of ${this.manager.options.heartbeat.interval} milliseconds and a timeout of ${this.manager.options.heartbeat.timeout} milliseconds.`);

		this.timer = setInterval(() => void this.check(), this.manager.options.heartbeat.interval);
		this.timer.unref();
	}

	public stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.manager._debug('The heartbeat monitor stopped.');

		this.timer = undefined;
		this.pending.clear();
	}

	public reset(cluster: RefCluster): void {
		this.manager._debug(`The heartbeat state for cluster ${cluster.id} was reset.`);
		this.pending.delete(cluster.id);

		const state = this.getClusterStats(cluster.id);
		state.missedHeartbeats = 0;
		this.failed.delete(cluster.id);
	}

	public receive(cluster: RefCluster, data: { nonce: string; receivedAt: number; ready: boolean }): void {
		if (!data || typeof data.nonce !== 'string' || !Number.isFinite(data.receivedAt) || typeof data.ready !== 'boolean') return;
		const pending = this.pending.get(cluster.id);
		if (!pending || pending.nonce !== data.nonce) return;

		this.pending.delete(cluster.id);
		this.manager._debug(`The heartbeat monitor received an acknowledgement from cluster ${cluster.id}; ready state is ${data.ready}.`);

		const state = this.getClusterStats(cluster.id);
		state.lastAckAt = data.receivedAt;
		state.missedHeartbeats = 0;

		cluster._setHeartbeat(data.receivedAt);
		this.failed.delete(cluster.id);
	}

	public getClusterStats(id: number): HeartbeatStats {
		const existing = this.stats.get(id);
		if (existing) return existing;

		const created = { restarts: 0, missedHeartbeats: 0 };
		this.stats.set(id, created);
		return created;
	}

	public getHealthSummary(): HeartbeatSummary[] {
		return [...this.manager.clusters.values()].map((cluster) => {
			const current = cluster;
			const stats = this.getClusterStats(current.id);
			const status =
				current.lifecycleState === 'ready' && stats.missedHeartbeats === 0
					? 'healthy'
					: current.lifecycleState === 'starting'
						? 'starting'
						: current.lifecycleState === 'stopped'
							? 'stopped'
							: 'degraded';

			return { ...stats, clusterId: current.id, status, missedBeats: stats.missedHeartbeats };
		});
	}

	private async check(): Promise<void> {
		for (const cluster of this.manager.clusters.values()) {
			const current = cluster;
			if (!current.thread || current.lifecycleState === 'starting' || current.lifecycleState === 'stopping') continue;

			const state = this.getClusterStats(current.id);
			const now = Date.now();
			const pending = this.pending.get(current.id);

			if (pending) {
				if (now - pending.sentAt <= this.manager.options.heartbeat.timeout) continue;
				this.pending.delete(current.id);
				state.missedHeartbeats += 1;
				this.manager._debug(`The heartbeat probe for cluster ${current.id} timed out; the cluster has missed ${state.missedHeartbeats} probes.`);
				this.reportIfUnhealthy(current, state);
				continue;
			}

			const nonce = ShardingUtils.generateNonce();
			state.lastPingAt = now;

			this.pending.set(current.id, { nonce, sentAt: now });
			this.manager._debug(`The heartbeat monitor sent a probe to cluster ${current.id} with nonce ${nonce}.`);

			void current._sendInstance({ _type: MessageTypes.Heartbeat, _nonce: nonce, data: { nonce, sentAt: now } }).catch((error: unknown) => {
				const pendingProbe = this.pending.get(current.id);
				if (!pendingProbe || pendingProbe.nonce !== nonce) return;

				this.pending.delete(current.id);
				state.missedHeartbeats += 1;

				this.manager._debug(`The heartbeat probe for cluster ${current.id} failed after ${state.missedHeartbeats} misses with ${error instanceof Error ? error.message : String(error)}.`);
				this.reportIfUnhealthy(current, state);
			});
		}
	}

	private reportIfUnhealthy(cluster: RefCluster, state: HeartbeatStats): void {
		if (state.missedHeartbeats < this.manager.options.heartbeat.maxMissedHeartbeats || this.failed.has(cluster.id)) return;
		this.manager._debug(`Cluster ${cluster.id} is unhealthy after ${state.missedHeartbeats} missed heartbeats, so recovery was requested.`);

		this.failed.add(cluster.id);
		state.restarts += 1;
		
		this.manager.ready = false;
		cluster._markDegraded('heartbeat-timeout');
	}
}
