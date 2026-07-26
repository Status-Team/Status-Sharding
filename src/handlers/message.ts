import { BaseMessage, DataType, DataTypes, EvalMessage } from '../other/message';
import { ClientRefType, ClusterClient } from '../core/clusterClient';
import { MessageTypes, PackageType, Serializable } from '../types';
import { ShardingUtils } from '../other/shardingUtils';
import { Worker } from '../classes/worker';
import { Cluster } from '../core/cluster';
import { Child } from '../classes/child';

/** Handles messages for the cluster. */
export class ClusterHandler {
	/** Creates an instance of ClusterHandler. */
	constructor (private cluster: Cluster, private ipc: Worker | Child) { }

	/** Handles the message received, and executes the callback. (Not meant to be used by the user.) */
	public async handleMessage<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): Promise<void> {
		switch (message._type) {
			case MessageTypes.ClientReady: {
				if (this.cluster.ready) {
					this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Received duplicate ready signal, ignoring.`);
					return;
				}

				const readyData = message.data as { packageType?: PackageType | null } | undefined;
				if (readyData?.packageType && !this.cluster.manager.options.packageType) {
					this.cluster.manager.options.packageType = readyData.packageType;
					this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Package type set to: ${readyData.packageType}`);
				}

				this.cluster.ready = true;
				this.cluster.exited = false;
				this.cluster.lastHeartbeatReceived = Date.now();

				this.cluster.emit('ready', this.cluster);
				this.cluster.manager.emit('clusterReady', this.cluster);
				this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Cluster is ready.`);

				const allReady = this.cluster.manager.clusters.every((cluster) => cluster.ready);

				if (!this.cluster.manager.reCluster.active && !this.cluster.manager.ready && allReady && this.cluster.manager.clusters.size === this.cluster.manager.options.totalClusters) {
					this.cluster.manager.ready = true;

					this.cluster.manager.emit('ready', this.cluster.manager);
					this.cluster.manager._debug('All clusters are ready.');

					for (const cluster of this.cluster.manager.clusters.values()) {
						cluster._sendInstance({ _type: MessageTypes.ManagerReady } as BaseMessage<'readyOrSpawn'>);
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
				const { clusterDelay, respawnDelay, timeout, except } = message.data as DataTypes['respawnAll'];
				void this.cluster.manager.respawnAll(clusterDelay, respawnDelay, timeout, except).catch((error) => {
					this.cluster.manager._debug(`[ClusterManager] Failed to respawn all clusters: ${(error as Error).message}`);
				});
				break;
			}
			case MessageTypes.ClientRespawnSpecific: {
				const { clusterDelay, respawnDelay, timeout, clusterIds } = message.data as DataTypes['respawnSome'];
				void this.cluster.manager.respawnClusters(clusterIds, clusterDelay, respawnDelay, timeout).catch((error) => {
					this.cluster.manager._debug(`[ClusterManager] Failed to respawn requested clusters: ${(error as Error).message}`);
				});
				break;
			}
			case MessageTypes.ClientRespawn: {
				const { respawnDelay, timeout } = message.data as Omit<DataTypes['respawnAll'], 'clusterDelay' | 'except'>;
				void this.cluster.respawn(respawnDelay, timeout).catch((error) => {
					this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Failed to respawn: ${(error as Error).message}`);
				});
				break;
			}
			case MessageTypes.ClientSpawnNextCluster: {
				this.cluster.manager.clusterQueue.next();
				break;
			}
			case MessageTypes.HeartbeatAck: {
				this.cluster.lastHeartbeatReceived = Date.now();
				this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Received heartbeat.`);
				break;
			}
		}
	}
}

/** Handles messages for the cluster client. */
export class ClusterClientHandler<InternalClient extends ClientRefType = ClientRefType> {
	/** Creates an instance of ClusterClientHandler. */
	constructor (private clusterClient: ClusterClient<InternalClient>) { }

	/** Handles the message received, and executes the callback. (Not meant to be used by the user.) */
	public async handleMessage<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): Promise<void> {
		switch (message._type) {
			case MessageTypes.ClientEvalRequest: {
				const { script } = message.data as EvalMessage;
				if (!script) {
					this.clusterClient._respond({
						_type: MessageTypes.ClientEvalResponseError,
						_nonce: message._nonce,
						data: ShardingUtils.makePlainError(new Error('No script provided.')),
					} as BaseMessage<'error'>);
					break;
				}

				const normalizedScript = script.replace(/(\n|\r|\t)/g, '').replace(/( )+/g, ' ').replace(/(\/\/.*)/g, '');

				try {
					const result = await this.clusterClient.evalOnClient(script);
					this.clusterClient._respond({
						_type: MessageTypes.ClientEvalResponse,
						_nonce: message._nonce,
						data: ShardingUtils.isSerializable(result) ? result : {
							...ShardingUtils.makePlainError(new Error('Evaluated script returned an unserializable value.')),
							script: normalizedScript,
						},
					} as BaseMessage<'evalResult'>);
				} catch (err) {
					this.clusterClient._respond({
						_type: MessageTypes.ClientEvalResponseError,
						_nonce: message._nonce,
						data: {
							...ShardingUtils.makePlainError(err instanceof Error ? err : new Error('An error occurred while evaluating the script.')),
							script: normalizedScript,
						},
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
			case MessageTypes.Heartbeat: {
				if (!this.clusterClient.info.RespondToHeartbeatWhenNotReady) {
					try {
						const readyForHeartbeat = await this.clusterClient.isReadyForHeartbeatAck();
						if (!readyForHeartbeat) {
							this.clusterClient._debug(`[Heartbeat] Skipping heartbeat ack on cluster ${this.clusterClient.id} because the client is not ready.`);
							break;
						}
					} catch (error) {
						this.clusterClient._debug(`[Heartbeat] Failed to check readiness for heartbeat ack on cluster ${this.clusterClient.id}: ${(error as Error).message}`);
						break;
					}
				}

				this.clusterClient._respond({ _type: MessageTypes.HeartbeatAck } as BaseMessage<'heartbeat'>);
				break;
			}
		}
	}
}
