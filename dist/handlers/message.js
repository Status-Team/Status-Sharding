"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterClientHandler = exports.ClusterHandler = void 0;
const shardingUtils_1 = require("../other/shardingUtils");
const types_1 = require("../types");
class ClusterHandler {
    cluster;
    ipc;
    constructor(cluster, ipc) {
        this.cluster = cluster;
        this.ipc = ipc;
    }
    handleMessage = async (message) => {
        switch (message._type) {
            case types_1.MessageTypes.ClientReady: {
                if (this.cluster.ready)
                    throw new Error('Cluster already ready, if autoLogin is enabled, check if you are not using .login() in your code.');
                this.cluster.ready = true;
                // Emitted upon the cluster's ready event.
                this.cluster.emit('ready', this.cluster);
                this.cluster.manager._debug(`[Cluster ${this.cluster.id}] Cluster is ready.`);
                if (this.cluster.manager.clusters.size === this.cluster.manager.options.totalClusters) {
                    this.cluster.manager.ready = true;
                    this.cluster.manager.emit('ready', this.cluster.manager);
                    this.cluster.manager._debug('All clusters are ready.');
                }
                break;
            }
            case types_1.MessageTypes.ClientBroadcastRequest: {
                const { script, options } = message.data;
                const results = await this.cluster.manager.broadcastEval(script, options);
                this.ipc.send({
                    _type: types_1.MessageTypes.ClientBroadcastResponse,
                    _nonce: message._nonce,
                    data: results,
                }).catch((err) => {
                    this.ipc.send({
                        _type: types_1.MessageTypes.ClientBroadcastResponseError,
                        _nonce: message._nonce,
                        data: shardingUtils_1.ShardingUtils.makePlainError(err),
                    });
                });
                break;
            }
            case types_1.MessageTypes.ClientManagerEvalRequest: {
                const { script, options } = message.data;
                const result = await this.cluster.manager.eval(script, options);
                if (result.error) {
                    this.ipc.send({
                        _type: types_1.MessageTypes.ClientManagerEvalResponseError,
                        _nonce: message._nonce,
                        data: shardingUtils_1.ShardingUtils.makePlainError(result.error),
                    });
                }
                else {
                    this.ipc.send({
                        _type: types_1.MessageTypes.ClientManagerEvalResponse,
                        _nonce: message._nonce,
                        data: result.result,
                    });
                }
                break;
            }
            case types_1.MessageTypes.CustomReply:
            case types_1.MessageTypes.ClientEvalResponseError:
            case types_1.MessageTypes.ClientEvalResponse: {
                this.cluster.manager.promise.resolve(message);
                break;
            }
            case types_1.MessageTypes.ClientRespawnAll: {
                const { clusterDelay, respawnDelay, timeout } = message.data;
                this.cluster.manager.respawnAll({ clusterDelay, respawnDelay, timeout });
                break;
            }
            case types_1.MessageTypes.ClientRespawn: {
                const { respawnDelay, timeout } = message.data;
                this.cluster.respawn(respawnDelay, timeout);
                break;
            }
            case types_1.MessageTypes.ClientMaintenance: {
                this.cluster.triggerMaintenance(message.data);
                break;
            }
            case types_1.MessageTypes.ClientMaintenanceAll: {
                this.cluster.manager.triggerMaintenance(message.data);
                break;
            }
            case types_1.MessageTypes.ClientSpawnNextCluster: {
                this.cluster.manager.clusterQueue.next();
                break;
            }
            case types_1.MessageTypes.Heartbeat: {
                this.ipc.send({ _type: types_1.MessageTypes.Heartbeat });
                break;
            }
            case types_1.MessageTypes.HeartbeatAck: {
                this.cluster.lastHeartbeatReceived = Date.now();
                break;
            }
        }
    };
}
exports.ClusterHandler = ClusterHandler;
class ClusterClientHandler {
    clusterClient;
    constructor(clusterClient) {
        this.clusterClient = clusterClient;
    }
    handleMessage = async (message) => {
        switch (message._type) {
            case types_1.MessageTypes.ClientEvalRequest: {
                const { script } = message.data;
                try {
                    if (!script)
                        throw new Error('Eval Script not provided.');
                    const result = await this.clusterClient.evalOnClient(script);
                    this.clusterClient._respond('evalResult', {
                        _type: types_1.MessageTypes.ClientEvalResponse,
                        _nonce: message._nonce,
                        data: result,
                    });
                }
                catch (err) {
                    this.clusterClient._respond('error', {
                        _type: types_1.MessageTypes.ClientEvalResponseError,
                        _nonce: message._nonce,
                        data: shardingUtils_1.ShardingUtils.makePlainError(err),
                    });
                }
                break;
            }
            case types_1.MessageTypes.CustomReply:
            case types_1.MessageTypes.ClientManagerEvalResponse:
            case types_1.MessageTypes.ClientManagerEvalResponseError:
            case types_1.MessageTypes.ClientBroadcastResponse:
            case types_1.MessageTypes.ClientBroadcastResponseError: {
                this.clusterClient.promise.resolve(message);
                break;
            }
            case types_1.MessageTypes.ClientMaintenanceDisable: {
                this.clusterClient.maintenance = '';
                this.clusterClient.emit('ready', this.clusterClient);
                break;
            }
            case types_1.MessageTypes.ClientMaintenanceEnable: {
                this.clusterClient.maintenance = message.data || '';
                break;
            }
            case types_1.MessageTypes.Heartbeat: {
                this.clusterClient._respond('heartbeat', { _type: types_1.MessageTypes.HeartbeatAck });
                break;
            }
        }
    };
}
exports.ClusterClientHandler = ClusterClientHandler;
//# sourceMappingURL=message.js.map