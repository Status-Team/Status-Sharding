import { Serializable, SerializableInput } from '../types';
import { ClusterManager } from '../core/clusterManager';
import { ClusterClient } from '../core/clusterClient';

/**
 * Type of the broker message sent.
 * @export
 * @typedef {BrokerMessage}
 */
export type BrokerMessage = { _data: unknown; broker: string; };
/**
 * Type of the broker message handler.
 * @export
 * @typedef {BrokerMessageHandler}
 * @template {unknown} [T=unknown] - The type of the message.
 */
export type BrokerMessageHandler<T = unknown> = (message: T) => void;

/**
 * The IPC Broker Abstract class.
 * @abstract
 * @class IPCBrokerAbstract
 * @typedef {IPCBrokerAbstract}
 */
abstract class IPCBrokerAbstract {
	/**
	 * The listeners of the IPC Broker.
	 * @private
	 * @type {Map<string, BrokerMessageHandler[]>}
	 */
	private listeners: Map<string, BrokerMessageHandler[]> = new Map();
	/**
	 * Creates an instance of IPCBrokerAbstract.
	 * @constructor
	 * @param {(ClusterManager | ClusterClient)} instance - The instance of the IPC Broker.
	 */
	constructor(public readonly instance: ClusterManager | ClusterClient) {}

	/**
	 * Listens to a specific channel.
	 * @template {unknown} T - The type of the message.
	 * @param {string} channelName - The name of the channel to listen to.
	 * @param {BrokerMessageHandler<T>} callback - The callback to execute when a message is received.
	 */
	public listen<T>(channelName: string, callback: BrokerMessageHandler<T>): void {
		const listeners = this.listeners.get(channelName) ?? [];
		listeners.push(callback as BrokerMessageHandler);
		this.listeners.set(channelName, listeners);
	}

	/**
	 * Handles the message received, and executes the callback. (Not meant to be used by the user.)
	 * @param {BrokerMessage} message - The message received.
	 */
	public handleMessage(message: BrokerMessage): void {
		if (!message._data || !message.broker) return;

		const listeners = this.listeners.get(message.broker);
		if (!listeners) return;

		for (const listener of listeners) {
			listener(message._data);
		}
	}
}

/**
 * IPC Broker Manager class.
 * @export
 * @class IPCBrokerManager
 * @typedef {IPCBrokerManager}
 * @extends {IPCBrokerAbstract}
 */
export class IPCBrokerManager extends IPCBrokerAbstract {
	/**
	 * Sends a message to a specific channel.
	 * @async
	 * @template {Serializable} T - The type of the message.
	 * @param {string} channelName - The name of the channel to send the message to.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @param {?number} [clusterId] - The id of the cluster to send the message to. (If not provided, it will send the message to all clusters.)
	 * @returns {Promise<void>} The promise.
	 */
	public async send<T extends Serializable>(channelName: string, message: SerializableInput<T>, clusterId?: number): Promise<void> {
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

/**
 * IPC Broker Client class.
 * @export
 * @class IPCBrokerClient
 * @typedef {IPCBrokerClient}
 * @extends {IPCBrokerAbstract}
 */
export class IPCBrokerClient extends IPCBrokerAbstract {
	/**
	 * Sends a message to a specific channel.
	 * @async
	 * @template {Serializable} T - The type of the message.
	 * @param {string} channelName - The name of the channel to send the message to.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @returns {Promise<void>} The promise.
	 */
	public async send<T extends Serializable>(channelName: string, message: SerializableInput<T>): Promise<void> {
		if (this.instance instanceof ClusterClient) {
			return this.instance.process?.send({
				_data: message,
				broker: channelName,
			});
		}
	}
}
