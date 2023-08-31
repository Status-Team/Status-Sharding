import { ClusterManager } from '../core/clusterManager';
import { ClusterClient } from '../core/clusterClient';

export type BrokerMessageHandler<T = unknown> = (message: T) => void;

export class IPCBroker {
	private listeners: Map<string, BrokerMessageHandler[]> = new Map();

	constructor(public readonly instance: ClusterManager | ClusterClient) {}

	public async send<T>(channelName: string, message: T): Promise<void> {
		return this.instance.broker.handleMessage({ _data: message, broker: channelName });
	}

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
