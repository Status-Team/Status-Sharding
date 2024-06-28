import { BaseMessage, DataType, DataTypes, EvalMessage } from '../other/message';
import { ClusterClient, ShardingClient } from '../core/clusterClient';
import { ShardingUtils } from '../other/shardingUtils';
import { MessageTypes, Serializable } from '../types';
import { Worker } from '../classes/worker';
import { Cluster } from '../core/cluster';
import { Child } from '../classes/child';

/**
 * Handles messages for the cluster.
 * @export
 * @class ClusterHandler
 * @typedef {ClusterHandler}
 */
export class ClusterHandler {
	/**
	 * Creates an instance of ClusterHandler.
	 * @constructor
	 * @param {Cluster} cluster - The cluster.
	 * @param {(Worker | Child)} ipc - The IPC process.
	 */
	constructor(private cluster: Cluster, private ipc: Worker | Child) {}

	/**
	 * Handles the message received, and executes the callback. (Not meant to be used by the user.)
	 * @async
	 * @template {DataType} D - The type of the message.
	 * @template {Serializable} A - The type of the message data.
	 * @template {object} P - The type of the message options.
	 * @param {BaseMessage<D, A, P>} message - The message received.
	 * @returns {Promise<void>} The promise.
	 */
	public async handleMessage<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): Promise<void> {
		switch (message._type) {
			case MessageTypes.ClientReady: {
				if (this.cluster.ready) throw new Error('Cluster already ready, if autoLogin is enabled, check if you are not using .login() in your code.');
				this.cluster.ready = true;

				// Emitted upon the cluster's ready event.
				this.cluster.emit('ready', this.cluster);
				this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Cluster is ready.`);

				const allReady = this.cluster.manager.clusters.every((cluster) => cluster.ready);
				if (allReady && this.cluster.manager.clusters.size === this.cluster.manager.options.totalClusters) {
					this.cluster.manager.ready = true;
					this.cluster.manager.emit('ready', this.cluster.manager);
					this.cluster.manager._debug('All clusters are ready.');

					for (const _ of this.cluster.manager.clusters.values()) {
						this.ipc.send({ _type: MessageTypes.ManagerReady } as BaseMessage<'readyOrSpawn'>);
					}
				}

				break;
			}
			case MessageTypes.ClientBroadcastRequest: {
				const { script, options } = message.data as EvalMessage;
				const results = await this.cluster.manager.broadcastEval(script, options);

				this.ipc.send({
					_type: MessageTypes.ClientBroadcastResponse,
					_nonce: message._nonce,
					data: results,
				} as BaseMessage<'evalResult'>).catch((err) => {
					this.ipc.send({
						_type: MessageTypes.ClientBroadcastResponseError,
						_nonce: message._nonce,
						data: ShardingUtils.makePlainError(err),
					} as BaseMessage<'error'>);
				});

				break;
			}
			case MessageTypes.ClientBroadcast: {
				const data = message.data as { message: Serializable; ignore?: number; };
				await this.cluster.manager.broadcast(data.message, data.ignore !== undefined ? [data.ignore] : undefined);

				break;
			}
			case MessageTypes.ClientManagerEvalRequest: {
				const { script, options } = message.data as EvalMessage;
				const result = await this.cluster.manager.eval(script, options);

				if (result.error) {
					this.ipc.send({
						_type: MessageTypes.ClientManagerEvalResponseError,
						_nonce: message._nonce,
						data: ShardingUtils.makePlainError(result.error),
					} as BaseMessage<'error'>);
				} else {
					this.ipc.send({
						_type: MessageTypes.ClientManagerEvalResponse,
						_nonce: message._nonce,
						data: result.result,
					} as BaseMessage<'evalResult'>);
				}

				break;
			}
			case MessageTypes.CustomReply:
			case MessageTypes.ClientEvalResponseError:
			case MessageTypes.ClientEvalResponse: {
				this.cluster.manager.promise.resolve(message);
				break;
			}
			case MessageTypes.ClientRespawnAll: {
				const { clusterDelay, respawnDelay, timeout } = message.data as DataTypes['respawn'];
				this.cluster.manager.respawnAll(clusterDelay, respawnDelay, timeout);
				break;
			}
			case MessageTypes.ClientRespawn: {
				const { respawnDelay, timeout } = message.data as DataTypes['respawn'];
				this.cluster.respawn(respawnDelay, timeout);
				break;
			}
			case MessageTypes.ClientMaintenance: {
				this.cluster.triggerMaintenance(message.data as DataTypes['maintenance']);
				break;
			}
			case MessageTypes.ClientMaintenanceAll: {
				this.cluster.manager.triggerMaintenance(message.data as DataTypes['maintenance']);
				break;
			}
			case MessageTypes.ClientSpawnNextCluster: {
				this.cluster.manager.clusterQueue.next();
				break;
			}
			case MessageTypes.Heartbeat: {
				this.ipc.send({ _type: MessageTypes.Heartbeat } as BaseMessage<'heartbeat'>);
				break;
			}
			case MessageTypes.HeartbeatAck: {
				this.cluster.lastHeartbeatReceived = Date.now();
				break;
			}
		}
	}
}

/**
 * Handles messages for the cluster client.
 * @export
 * @class ClusterClientHandler
 * @typedef {ClusterClientHandler}
 * @template {ShardingClient} [InternalClient=ShardingClient] - The type of the internal client.
 */
export class ClusterClientHandler<InternalClient extends ShardingClient = ShardingClient> {
	/**
	 * Creates an instance of ClusterClientHandler.
	 * @constructor
	 * @param {ClusterClient<InternalClient>} clusterClient - The cluster client.
	 */
	constructor(private clusterClient: ClusterClient<InternalClient>) {}

	/**
	 * Handles the message received, and executes the callback. (Not meant to be used by the user.)
	 * @async
	 * @template {DataType} D - The type of the message.
	 * @template {Serializable} A - The type of the message data.
	 * @template {object} P - The type of the message options.
	 * @param {BaseMessage<D, A, P>} message - The message received.
	 * @returns {Promise<void>} The promise.
	 */
	public async handleMessage<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): Promise<void> {
		switch (message._type) {
			case MessageTypes.ClientEvalRequest: {
				const { script } = message.data as EvalMessage;
				try {
					if (!script) return this.clusterClient._respond({
						_type: MessageTypes.ClientEvalResponseError,
						_nonce: message._nonce,
						data: ShardingUtils.makePlainError(new Error('No script provided.')),
					} as BaseMessage<'error'>);

					const result = await this.clusterClient.evalOnClient(script);

					this.clusterClient._respond({
						_type: MessageTypes.ClientEvalResponse,
						_nonce: message._nonce,
						data: ShardingUtils.isSerializable(result) ? result : {
							...ShardingUtils.makePlainError(new Error('Evaluated script returned an unserializable value.')),
							script: script?.replace(/(\n|\r|\t)/g, '').replace(/( )+/g, ' ').replace(/(\/\/.*)/g, ''),
						},
					} as BaseMessage<'evalResult'>);
				} catch (err) {
					this.clusterClient._respond({
						_type: MessageTypes.ClientEvalResponseError,
						_nonce: message._nonce,
						data: ShardingUtils.makePlainError(err as Error),
					} as BaseMessage<'error'>);
				}

				break;
			}
			case MessageTypes.CustomReply:
			case MessageTypes.ClientManagerEvalResponse:
			case MessageTypes.ClientManagerEvalResponseError:
			case MessageTypes.ClientBroadcastResponse:
			case MessageTypes.ClientBroadcastResponseError: {
				this.clusterClient.promise.resolve(message);
				break;
			}
			case MessageTypes.ManagerReady: {
				this.clusterClient.emit('managerReady');
				break;
			}
			case MessageTypes.ClientMaintenanceDisable: {
				this.clusterClient.maintenance = '';
				this.clusterClient.emit('ready', this.clusterClient);
				break;
			}
			case MessageTypes.ClientMaintenanceEnable: {
				this.clusterClient.maintenance = (message.data as DataTypes['maintenance']) || '';
				break;
			}
			case MessageTypes.Heartbeat: {
				this.clusterClient._respond({ _type: MessageTypes.HeartbeatAck } as BaseMessage<'heartbeat'>);
				break;
			}
		}
	}
}
