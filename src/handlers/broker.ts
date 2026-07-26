import { Serializable, SerializableInput } from '../types';
import { ClusterManager } from '../core/clusterManager';
import { ClusterClient } from '../core/clusterClient';

/** Type of the broker message sent. */
export type BrokerMessage = { _data: unknown; broker: string; };
/** Type of the broker message handler. */
export type BrokerMessageHandler<T = unknown> = (message: T) => void;

/** The IPC Broker Abstract class. */
abstract class IPCBrokerAbstract {
	/** The listeners of the IPC Broker. */
	private listeners: Map<string, BrokerMessageHandler[]> = new Map();
	/** Creates an instance of IPCBrokerAbstract. */
	constructor(public readonly instance: ClusterManager | ClusterClient) {}

	/** Listens to a specific channel. */
	public listen<T>(channelName: string, callback: BrokerMessageHandler<T>): void {
		const listeners = this.listeners.get(channelName) ?? [];
		listeners.push(callback as BrokerMessageHandler);
		this.listeners.set(channelName, listeners);
	}

	/** Handles the message received, and executes the callback. (Not meant to be used by the user.) */
	public handleMessage(message: BrokerMessage | unknown): void {
		if (!message || typeof message !== 'object') return;
		if (!('_data' in message) || !('broker' in message)) return;

		const brokerMessage = message as BrokerMessage;
		if (typeof brokerMessage.broker !== 'string' || brokerMessage.broker.length === 0) return;

		const listeners = this.listeners.get(brokerMessage.broker);
		if (!listeners) return;

		for (const listener of listeners) {
			listener(brokerMessage._data);
		}
	}
}

/** IPC Broker Manager class. */
export class IPCBrokerManager extends IPCBrokerAbstract {
	/** Sends a message to a specific channel. */
	public async send<T extends Serializable>(channelName: string, message: SerializableInput<T>, clusterId?: number): Promise<void> {
		if (this.instance instanceof ClusterManager) {
			if (clusterId === undefined) {
				await Promise.allSettled(Array.from(this.instance.clusters.values()).map(async (cluster) => {
					if (!cluster.thread) return;
					await cluster.thread.send({
						_data: message,
						broker: channelName,
					});
				}));
			} else {
				const cluster = this.instance.clusters.get(clusterId);
				if (!cluster) return Promise.reject(new Error('BROKER_INVALID_CLUSTER_ID | Invalid cluster id provided.'));
				if (!cluster.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + clusterId + ' does not have a child process/worker.'));

				await cluster.thread.send({
					_data: message,
					broker: channelName,
				});
			}
		}
	}
}

/** IPC Broker Client class. */
export class IPCBrokerClient extends IPCBrokerAbstract {
	/** Sends a message to a specific channel. */
	public async send<T extends Serializable>(channelName: string, message: SerializableInput<T>): Promise<void> {
		if (this.instance instanceof ClusterClient) {
			return this.instance.process?.send({
				_data: message,
				broker: channelName,
			});
		}
	}
}
