"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPCBrokerClient = exports.IPCBrokerManager = void 0;
const clusterManager_1 = require("../core/clusterManager");
const clusterClient_1 = require("../core/clusterClient");
class IPCBrokerAbstract {
    instance;
    listeners = new Map();
    constructor(instance) {
        this.instance = instance;
    }
    listen(channelName, callback) {
        const listeners = this.listeners.get(channelName) ?? [];
        listeners.push(callback);
        this.listeners.set(channelName, listeners);
    }
    // Not meant to be used by the user.
    handleMessage({ _data, broker }) {
        if (!_data || !broker)
            return;
        const listeners = this.listeners.get(broker);
        if (!listeners)
            return;
        for (const listener of listeners) {
            listener(_data);
        }
    }
}
class IPCBrokerManager extends IPCBrokerAbstract {
    async send(channelName, message, clusterId) {
        if (this.instance instanceof clusterManager_1.ClusterManager) {
            if (clusterId === undefined) {
                for (const cluster of this.instance.clusters.values()) {
                    cluster.thread?.send({
                        _data: message,
                        broker: channelName,
                    });
                }
            }
            else {
                const cluster = this.instance.clusters.get(clusterId);
                if (!cluster)
                    return Promise.reject(new Error('BROKER_INVALID_CLUSTER_ID | Invalid cluster id provided.'));
                return cluster.thread?.send({
                    _data: message,
                    broker: channelName,
                });
            }
        }
    }
}
exports.IPCBrokerManager = IPCBrokerManager;
class IPCBrokerClient extends IPCBrokerAbstract {
    async send(channelName, message) {
        if (this.instance instanceof clusterClient_1.ClusterClient) {
            return this.instance.process?.send({
                _data: message,
                broker: channelName,
            });
        }
    }
}
exports.IPCBrokerClient = IPCBrokerClient;
//# sourceMappingURL=broker.js.map