"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterClient = exports.ShardingClient = void 0;
const types_1 = require("../types");
const discord_js_1 = require("discord.js");
const message_1 = require("../other/message");
const message_2 = require("../handlers/message");
const shardingUtils_1 = require("../other/shardingUtils");
const promise_1 = require("../handlers/promise");
const worker_1 = require("../classes/worker");
const child_1 = require("../classes/child");
const data_1 = require("../other/data");
const events_1 = __importDefault(require("events"));
class ShardingClient extends discord_js_1.Client {
    cluster;
    constructor(options) {
        super({
            ...options,
            shards: (0, data_1.getInfo)().ShardList,
            shardCount: (0, data_1.getInfo)().TotalShards,
        });
        this.cluster = new ClusterClient(this);
    }
}
exports.ShardingClient = ShardingClient;
class ClusterClient extends events_1.default {
    client;
    ready;
    maintenance;
    promise;
    process;
    messageHandler;
    constructor(client) {
        super();
        this.client = client;
        // If the Cluster is under maintenance.
        this.maintenance = '';
        // Wait 100ms so listener can be added.
        this.ready = false;
        this.process = (this.info.ClusterManagerMode === 'process' ? new child_1.ChildClient() : this.info.ClusterManagerMode === 'worker' ? new worker_1.WorkerClient() : null);
        this.messageHandler = new message_2.ClusterClientHandler(this);
        // Handle messages from the ClusterManager.
        this.process?.ipc?.on('message', this._handleMessage.bind(this));
        this.promise = new promise_1.PromiseHandler();
        // Login the Client.
        if (this.info.AutoLogin && client?.login)
            client.login(this.info.Token);
        if (client?.once)
            client.once('ready', () => {
                this.triggerReady();
            });
    }
    // Cluster's id.
    get id() {
        return this.info.ClusterId;
    }
    // Total number of shards.
    get totalShards() {
        return this.info.TotalShards;
    }
    // Total number of clusters.
    get totalClusters() {
        return this.info.ClusterCount;
    }
    // Gets some Info about the Cluster.
    get info() {
        return (0, data_1.getInfo)();
    }
    // Sends a message to the Cluster as child. (Cluster, _handleMessage).
    send(message) {
        this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
        return this.process?.send({
            data: message,
            _type: types_1.MessageTypes.CustomMessage,
        });
    }
    // This is not intended to be used by the user.
    _sendInstance(message) {
        if (!('_type' in message) || !('data' in message))
            return Promise.reject(new Error('CLUSTERING_INVALID_MESSAGE | Invalid message object.' + JSON.stringify(message)));
        this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
        return this.process?.send(message);
    }
    async evalOnManager(script, options) {
        const nonce = shardingUtils_1.ShardingUtils.generateNonce();
        this.process?.send({
            data: {
                options,
                script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`,
            },
            _nonce: nonce,
            _type: types_1.MessageTypes.ClientManagerEvalRequest,
        });
        return this.promise.create(nonce, options?.timeout);
    }
    async broadcastEval(script, options) {
        const nonce = shardingUtils_1.ShardingUtils.generateNonce();
        this.process?.send({
            data: {
                options,
                script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`,
            },
            _nonce: nonce,
            _type: types_1.MessageTypes.ClientBroadcastRequest,
        });
        return this.promise.create(nonce, options?.timeout);
    }
    async evalOnGuild(guildId, script, options) {
        const nonce = shardingUtils_1.ShardingUtils.generateNonce();
        this.process?.send({
            data: {
                script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''}, this?.guilds?.cache?.get('${guildId}'))`,
                options: {
                    ...options,
                    guildId,
                },
            },
            _nonce: nonce,
            _type: types_1.MessageTypes.ClientBroadcastRequest,
        });
        return this.promise.create(nonce, options?.timeout).then((data) => data?.[0]);
    }
    async evalOnClient(script, options) {
        if (this.client._eval)
            return await this.client._eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
        this.client._eval = function (_) { return eval(_); }.bind(this.client);
        return await this.client._eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
    }
    // Sends a Request to the ParentCluster and returns the reply.
    request(message, options = {}) {
        if (!this.process)
            return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to.'));
        const nonce = shardingUtils_1.ShardingUtils.generateNonce();
        this.process?.send({
            data: message,
            _type: types_1.MessageTypes.CustomRequest,
            _nonce: nonce,
        });
        return this.promise.create(nonce, options.timeout);
    }
    // Requests a respawn of all clusters.
    respawnAll(options = {}) {
        if (!this.process)
            return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to.'));
        return this.process?.send({
            data: options,
            _type: types_1.MessageTypes.ClientRespawnAll,
        });
    }
    // Handles an IPC message.
    _handleMessage(message) {
        if (!message)
            return;
        // Debug.
        this.emit('debug', `[IPC] [Child ${this.id}] Received message from cluster.`);
        this.messageHandler?.handleMessage(message);
        // Emitted upon receiving a message from the child process/worker.
        if ([types_1.MessageTypes.CustomMessage, types_1.MessageTypes.CustomRequest].includes(message._type)) {
            this.emit('message', new message_1.ProcessMessage(this, message));
        }
    }
    // Sends a message to the master process, emitting an error from the client upon failure.
    _respond(type, message) {
        this.process?.send(message)?.catch((err) => this.client.emit('error', err));
    }
    // Triggers the ready event.
    triggerReady() {
        this.ready = true;
        this.process?.send({
            _type: types_1.MessageTypes.ClientReady,
        });
        this.emit('ready', this);
        return this.ready;
    }
    // Whether the cluster should opt in maintenance when a reason was provided or opt-out when no reason was provided.
    triggerMaintenance(maintenance, all = false) {
        this.maintenance = maintenance;
        this.process?.send({
            data: maintenance,
            _type: all ? types_1.MessageTypes.ClientMaintenanceAll : types_1.MessageTypes.ClientMaintenance,
        });
        return this.maintenance;
    }
    // Manually spawn the next cluster, when queue mode is on 'manual'.
    spawnNextCluster() {
        if (this.info.ClusterQueueMode === 'auto')
            throw new Error('Next Cluster can just be spawned when the queue is not on auto mode.');
        return this.process?.send({
            _type: types_1.MessageTypes.ClientSpawnNextCluster,
        });
    }
}
exports.ClusterClient = ClusterClient;
//# sourceMappingURL=clusterClient.js.map