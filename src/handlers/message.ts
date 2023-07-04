import { BaseMessage, DataType, DataTypes, EvalMessage } from '../other/message';
import { ClusterClient, ShardingClient } from '../core/clusterClient';
import { ShardingUtils } from '../other/shardingUtils';
import { Worker } from '../classes/worker';
import { Cluster } from '../core/cluster';
import { Child } from '../classes/child';
import { MessageTypes } from '../types';

export class ClusterHandler {
	constructor(private cluster: Cluster, private ipc: Worker | Child) {}

	handleMessage = async <D extends DataType>(message: BaseMessage<D>): Promise<void> => {
		switch (message._type) {
			case MessageTypes.ClientReady: {
				if (this.cluster.ready) throw new Error('Cluster already ready, if autoLogin is enabled, check if you are not using .login() in your code.');
				this.cluster.ready = true;

				// Emitted upon the cluster's ready event.
				this.cluster.emit('ready');
				this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Cluster is ready.`);

				if (this.cluster.manager.clusters.size === this.cluster.manager.options.totalClusters) {
					this.cluster.manager.ready = true;
					this.cluster.manager.emit('ready', this.cluster.manager);
					this.cluster.manager._debug('All clusters are ready.');
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
				this.cluster.manager.respawnAll({ clusterDelay, respawnDelay, timeout });
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
	};
}

export class ClusterClientHandler<InternalClient extends ShardingClient = ShardingClient> {
	constructor(private clusterClient: ClusterClient<InternalClient>) {}

	handleMessage = async (message: BaseMessage<DataType, unknown>): Promise<void> => {
		switch (message._type) {
			case MessageTypes.ClientEvalRequest: {
				const { script } = message.data as EvalMessage;
				try {
					if (!script) throw new Error('Eval Script not provided.');

					const result = await this.clusterClient.evalOnClient(script);
					this.clusterClient._respond('evalResult', {
						_type: MessageTypes.ClientEvalResponse,
						_nonce: message._nonce,
						data: result,
					} as BaseMessage<'evalResult'>);
				} catch (err) {
					this.clusterClient._respond('error', {
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
			case MessageTypes.ClientMaintenanceDisable: {
				this.clusterClient.maintenance = false;
				this.clusterClient.emit('ready', this.clusterClient);
				break;
			}
			case MessageTypes.ClientMaintenanceEnable: {
				this.clusterClient.maintenance = (message.data as DataTypes['maintenance']) || true;
				break;
			}
			case MessageTypes.Heartbeat: {
				this.clusterClient._respond('heartbeat', { _type: MessageTypes.HeartbeatAck } as BaseMessage<'heartbeat'>);
				break;
			}
		}
	};
}
