"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cluster = void 0;
const types_1 = require("../types");
const message_1 = require("../other/message");
const shardingUtils_1 = require("../other/shardingUtils");
const message_2 = require("../handlers/message");
const worker_1 = require("../classes/worker");
const child_1 = require("../classes/child");
const events_1 = __importDefault(require("events"));
const path_1 = __importDefault(require("path"));
// A self-contained cluster created by the ClusterManager.
// Each one has a Child that contains an instance of the bot and its Client.
// When its child process/worker exits for any reason, the cluster will spawn a new one to replace it as necessary.
class Cluster extends events_1.default {
    manager;
    id;
    shardList;
    ready;
    lastHeartbeatReceived;
    thread;
    messageHandler;
    envData;
    constructor(manager, id, shardList) {
        super();
        this.manager = manager;
        this.id = id;
        this.shardList = shardList;
        this.lastHeartbeatReceived = Date.now();
        this.ready = false;
        this.thread = null;
        this.envData = Object.assign({}, process.env, {
            SHARD_LIST: this.shardList,
            TOTAL_SHARDS: this.totalShards,
            CLUSTER: this.id,
            CLUSTER_MANAGER_MODE: this.manager.options.mode,
            CLUSTER_QUEUE_MODE: this.manager.options.queueOptions?.mode ?? 'auto',
            CLUSTER_COUNT: this.manager.options.totalClusters,
        });
    }
    get totalShards() {
        return this.manager.options.totalShards;
    }
    get totalClusters() {
        return this.manager.options.totalClusters;
    }
    async spawn(spawnTimeout = 30000) {
        if (this.thread)
            throw new Error('CLUSTER ALREADY SPAWNED | Cluster ' + this.id + ' has already been spawned.');
        const options = {
            ...this.manager.options.clusterOptions,
            execArgv: this.manager.options.execArgv,
            env: this.envData,
            args: [...(this.manager.options.shardArgs || []), '--clusterId ' + this.id, `--shards [${this.shardList.join(', ').trim()}]`],
            clusterData: { ...this.envData, ...this.manager.options.clusterData },
        };
        this.thread = this.manager.options.mode === 'process' ? new child_1.Child(path_1.default.resolve(this.manager.file), options) : new worker_1.Worker(path_1.default.resolve(this.manager.file), options);
        this.messageHandler = new message_2.ClusterHandler(this, this.thread);
        const thread = this.thread.spawn();
        thread.on('message', this._handleMessage.bind(this));
        thread.on('error', this._handleError.bind(this));
        thread.on('exit', this._handleExit.bind(this));
        this.emit('spawn', this.thread.process);
        if (spawnTimeout === -1 || spawnTimeout === Infinity)
            return this.thread.process;
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(spawnTimeoutTimer);
                this.off('ready', onReady);
                this.off('death', onDeath);
            };
            const onReady = () => {
                this.manager.emit('clusterReady', this);
                cleanup();
                resolve();
            };
            const onDeath = () => {
                cleanup();
                reject(new Error('CLUSTERING_READY_DIED | Cluster ' + this.id + ' died.'));
            };
            const onTimeout = () => {
                cleanup();
                reject(new Error('CLUSTERING_READY_TIMEOUT | Cluster ' + this.id + ' took too long to get ready.'));
            };
            const spawnTimeoutTimer = setTimeout(onTimeout, spawnTimeout);
            this.once('ready', onReady);
            this.once('death', onDeath);
        });
        return this.thread.process;
    }
    async kill(options) {
        this.thread?.kill();
        if (this.thread)
            this.thread = null;
        this.ready = false;
        this.manager.heartbeat.removeCluster(this.id);
        this.manager._debug('[KILL] Cluster killed with reason: ' + (options?.reason || 'Unknown reason.'));
    }
    async respawn(delay = this.manager.options.spawnOptions.delay || 800, timeout = this.manager.options.spawnOptions.timeout || 30000) {
        if (this.thread)
            await this.kill({ force: true });
        if (delay > 0)
            await shardingUtils_1.ShardingUtils.delayFor(delay);
        // const heartbeat = this.manager.heartbeat;
        // if (heartbeat) heartbeat.clusters.get(this.id)?.stop();
        return this.spawn(timeout);
    }
    async send(message) {
        if (!this.thread)
            return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker.'));
        this.manager._debug(`[IPC] [Cluster ${this.id}] Sending message to child.`);
        return this.thread?.send({
            _type: types_1.MessageTypes.CustomMessage,
            data: message,
        });
    }
    async request(message, options = {}) {
        if (!this.thread)
            return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker.'));
        const nonce = shardingUtils_1.ShardingUtils.generateNonce();
        this.thread?.send({
            _type: types_1.MessageTypes.CustomRequest,
            _nonce: nonce,
            data: message,
        });
        return this.manager.promise.create(nonce, options.timeout);
    }
    async eval(script, options) {
        return eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
    }
    async evalOnClient(script, options) {
        if (!this.thread)
            return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker.'));
        const nonce = shardingUtils_1.ShardingUtils.generateNonce();
        this.thread?.send({
            _type: types_1.MessageTypes.ClientEvalRequest,
            _nonce: nonce,
            data: {
                script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`,
                options: options,
            },
        });
        return this.manager.promise.create(nonce, options?.timeout);
    }
    async evalOnGuild(guildId, script, options) {
        return this.manager.evalOnGuild(guildId, typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`, options);
    }
    triggerMaintenance(reason) {
        return this.send({
            _type: reason ? types_1.MessageTypes.ClientMaintenanceEnable : types_1.MessageTypes.ClientMaintenanceDisable,
            data: reason || 'Unknown reason.',
        });
    }
    _sendInstance(message) {
        this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
        return this.thread?.send(message);
    }
    _handleMessage(message) {
        if (!message)
            return;
        this.manager._debug(`[IPC] [Cluster ${this.id}] Received message from child.`);
        this.messageHandler?.handleMessage(message);
        if ([types_1.MessageTypes.CustomMessage, types_1.MessageTypes.CustomRequest].includes(message._type)) {
            const ipcMessage = new message_1.ProcessMessage(this, message);
            if (message._type === types_1.MessageTypes.CustomRequest)
                this.manager.emit('clientRequest', ipcMessage);
            this.emit('message', ipcMessage);
        }
    }
    _handleExit(exitCode) {
        this.manager.heartbeat.removeCluster(this.id, true);
        this.emit('death', this, this.thread?.process);
        this.manager._debug('[Death] [Cluster ' + this.id + '] Cluster died with exit code ' + exitCode + '.');
        this.ready = false;
        this.thread = null;
    }
    _handleError(error) {
        this.manager.emit('error', error);
    }
}
exports.Cluster = Cluster;
//# sourceMappingURL=cluster.js.map