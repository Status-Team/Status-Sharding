import { ClusterManager } from '../core/clusterManager';
import { ClusterClient } from '../core/clusterClient';

export type BrokerMessageHandler<T = unknown> = (message: T) => void;

abstract class IPCBrokerAbstract {
	private listeners: Map<string, BrokerMessageHandler[]> = new Map();
	constructor(public readonly instance: ClusterManager | ClusterClient) {}

	public listen<T>(channelName: string, callback: BrokerMessageHandler<T>): void {
		const listeners = this.listeners.get(channelName) ?? [];
		listeners.push(callback as BrokerMessageHandler);
		this.listeners.set(channelName, listeners);
	}

	public handleMessage({ _data, broker }: { _data: unknown; broker: string; }): void {
		if (!_data || !broker) return;

		const listeners = this.listeners.get(broker);
		if (!listeners) return;

		for (const listener of listeners) {
			listener(_data);
		}
	}
}

export class IPCBrokerManager extends IPCBrokerAbstract {
	public async send<T>(channelName: string, message: T, clusterId?: number): Promise<void> {
		if (this.instance instanceof ClusterManager) {
			if (clusterId === undefined) {
				for (const cluster of this.instance.clusters.values()) {
					cluster.thread?.send({
						_data: message,
						broker: channelName,
					});
				}
			} else {
				const cluster = this.instance.clusters.get(clusterId);
				if (!cluster) return Promise.reject(new Error('BROKER_INVALID_CLUSTER_ID | Invalid cluster id provided.'));

				return cluster.thread?.send({
					_data: message,
					broker: channelName,
				});
			}
		}
	}
}

export class IPCBrokerClient extends IPCBrokerAbstract {
	public async send<T>(channelName: string, message: T): Promise<void> {
		if (this.instance instanceof ClusterClient) {
			return this.instance.process?.send({
				_data: message,
				broker: channelName,
			});
		}
	}
}
