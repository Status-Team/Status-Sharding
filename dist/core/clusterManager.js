"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterManager = void 0;
const heartbeat_1 = require("../plugins/heartbeat");
const reCluster_1 = require("../plugins/reCluster");
const shardingUtils_1 = require("../other/shardingUtils");
const promise_1 = require("../handlers/promise");
const queue_1 = require("../handlers/queue");
const cluster_1 = require("./cluster");
const events_1 = __importDefault(require("events"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
class ClusterManager extends events_1.default {
    file;
    ready; // Check if all clusters are ready.
    maintenance; // Maintenance mode reason.
    options; // Options for the ClusterManager.
    promise; // Promise Handler for the ClusterManager.
    clusters; // A collection of all clusters the manager spawned.
    reCluster; // ReCluster Manager for the ClusterManager.
    heartbeat; // Heartbeat Manager for the ClusterManager.
    clusterQueue; // Queue for the ClusterManager.
    constructor(file, options) {
        super();
        this.file = file;
        if (!file)
            throw new Error('CLIENT_INVALID_OPTION | No File specified.');
        this.file = path_1.default.isAbsolute(file) ? file : path_1.default.resolve(process.cwd(), file);
        if (!fs_1.default.statSync(this.file)?.isFile())
            throw new Error('CLIENT_INVALID_OPTION | Provided is file is not type of file.');
        if (options.mode !== 'worker' && options.mode !== 'process')
            throw new RangeError('CLIENT_INVALID_OPTION | Cluster mode must be "worker" or "process".');
        this.options = {
            ...options,
            totalShards: options.totalShards === undefined ? -1 : options.totalShards,
            totalClusters: options.totalClusters === undefined ? -1 : options.totalClusters,
            shardsPerClusters: options.shardsPerClusters === undefined ? -1 : options.shardsPerClusters,
            respawn: options.respawn === undefined ? true : options.respawn,
            heartbeat: shardingUtils_1.ShardingUtils.mergeObjects(options.heartbeat || {}, { maxRestarts: 3, interval: 30000, timeout: 45000, maxMissedHeartbeats: 4 }),
            mode: options.mode || 'worker',
            shardList: [], clusterList: [],
            spawnOptions: {
                timeout: options.spawnOptions?.timeout ?? -1,
                delay: options.spawnOptions?.delay ?? 8000,
            },
        };
        process.env.TOTAL_SHARDS = String(options.totalShards);
        process.env.CLUSTER_COUNT = String(options.totalClusters);
        process.env.CLUSTER_MANAGER_MODE = options.mode;
        process.env.DISCORD_TOKEN = String(options.token) || undefined;
        process.env.CLUSTER_QUEUE_MODE = options.queueOptions?.mode ?? 'auto';
        this.ready = false;
        this.clusters = new Map();
        this.maintenance = '';
        this.promise = new promise_1.PromiseHandler();
        this.reCluster = new reCluster_1.ReClusterManager(this);
        this.heartbeat = new heartbeat_1.HeartbeatManager(this);
        this.clusterQueue = new queue_1.Queue(this.options.queueOptions || {
            mode: 'auto', timeout: this.options.spawnOptions.timeout || 30000,
        });
        this._debug('[ClusterManager] Initialized successfully.');
    }
    // Spawns multiple internal clusters.
    async spawn() {
        if (this.options.spawnOptions.delay < 8000)
            process.emitWarning('Spawn Delay is smaller than 8s, this can cause global rate limits on /gateway/bot', {
                code: 'SHARDING_DELAY',
            });
        if (!this.options.token)
            throw new Error('CLIENT_INVALID_OPTION | No Token specified.');
        if (this.options.token?.includes('Bot ') || this.options.token?.includes('Bearer '))
            this.options.token = this.options.token.slice(this.options.token.indexOf(' ') + 1);
        const cpuCores = os_1.default.cpus().length;
        this.options.totalShards = this.options.totalShards !== -1 ? this.options.totalShards : await shardingUtils_1.ShardingUtils.getRecommendedShards(this.options.token) || 1;
        this.options.totalClusters = (this.options.totalClusters === -1) ? (cpuCores > this.options.totalShards ? this.options.totalShards : cpuCores) : this.options.totalClusters;
        this.options.shardsPerClusters = (this.options.shardsPerClusters === -1) ? Math.ceil(this.options.totalShards / this.options.totalClusters) : this.options.shardsPerClusters;
        if (this.options.totalShards < 1)
            this.options.totalShards = 1;
        if (this.options.totalClusters < 1)
            this.options.totalClusters = 1;
        if (this.options.totalClusters > this.options.totalShards)
            throw new Error('CLIENT_INVALID_OPTION | Total Clusters cannot be more than Total Shards.');
        if (this.options.shardsPerClusters > this.options.totalShards)
            throw new Error('CLIENT_INVALID_OPTION | Shards per Cluster cannot be more than Total Shards.');
        if (this.options.shardsPerClusters > (this.options.totalShards / this.options.totalClusters))
            throw new Error('CLIENT_INVALID_OPTION | Shards per Cluster cannot be more than Total Shards divided by Total Clusters.');
        if (!this.options.shardList?.length)
            this.options.shardList = new Array(this.options.totalShards).fill(0).map((_, i) => i);
        if (this.options.shardsPerClusters)
            this.options.totalClusters = Math.ceil((this.options.shardList?.length || 0) / this.options.shardsPerClusters) || 1;
        if (!this.options.clusterList?.length)
            this.options.clusterList = new Array(this.options.totalClusters).fill(0).map((_, i) => i);
        if (this.options.clusterList.length !== this.options.totalClusters)
            this.options.totalClusters = this.options.clusterList.length;
        if (this.options.totalShards < 1)
            throw new Error('CLIENT_INVALID_OPTION | Total Shards must be at least 1.');
        if (this.options.totalClusters < 1)
            throw new Error('CLIENT_INVALID_OPTION | Total Clusters must be at least 1.');
        if (this.options.shardsPerClusters < 1)
            throw new Error('CLIENT_INVALID_OPTION | Shards Per Cluster must be at least 1.');
        if (this.options.totalShards < this.options.shardList.length)
            throw new Error('CLIENT_INVALID_OPTION | Shard List is bigger than Total Shards.');
        if (this.options.totalClusters < this.options.clusterList.length)
            throw new Error('CLIENT_INVALID_OPTION | Cluster List is bigger than Total Clusters.');
        if (this.options.shardsPerClusters > this.options.totalShards)
            throw new Error('CLIENT_INVALID_OPTION | Shards Per Cluster is bigger than Total Shards.');
        if (this.options.shardList.some((shard) => shard < 0))
            throw new Error('CLIENT_INVALID_OPTION | Shard List has invalid shards.');
        if (this.options.clusterList.some((cluster) => cluster < 0))
            throw new Error('CLIENT_INVALID_OPTION | Cluster List has invalid clusters.');
        if (this.options.shardList.some((shard) => shard < 0))
            throw new Error('CLIENT_INVALID_OPTION | Shard List has invalid shards.');
        if (this.options.clusterList.some((cluster) => cluster < 0))
            throw new Error('CLIENT_INVALID_OPTION | Cluster List has invalid clusters.');
        this._debug(`[ClusterManager] Spawning ${this.options.totalClusters} Clusters with ${this.options.totalShards} Shards.`);
        const listOfShardsForCluster = shardingUtils_1.ShardingUtils.chunkArray(this.options.shardList || [], this.options.shardsPerClusters || this.options.totalShards);
        if (listOfShardsForCluster.length !== this.options.totalClusters)
            this.options.totalClusters = listOfShardsForCluster.length;
        this.options.totalShards = listOfShardsForCluster.reduce((acc, curr) => acc + curr.length, 0);
        this.options.totalClusters = listOfShardsForCluster.length;
        this.options.shardsPerClusters = Math.ceil(this.options.totalShards / this.options.totalClusters);
        for (let i = 0; i < this.options.totalClusters; i++) {
            if (listOfShardsForCluster[i]) {
                this._debug(`[ClusterManager] Added Cluster ${this.options.clusterList?.[i] || i} to the queue with ${listOfShardsForCluster[i]} shards.`);
                this.clusterQueue.add({
                    timeout: this.options.spawnOptions.delay * listOfShardsForCluster[i]?.length,
                    args: [this.options.spawnOptions.timeout !== -1 ? this.options.spawnOptions.timeout + this.options.spawnOptions.delay * listOfShardsForCluster[i]?.length : this.options.spawnOptions.timeout],
                    run: (...timeout) => this.createCluster(this.options.clusterList?.[i] || i, listOfShardsForCluster[i]).spawn(...timeout),
                });
            }
        }
        return this.clusterQueue.start();
    }
    // Sends a message to all clusters.
    async broadcast(message) {
        const promises = Array.from(this.clusters.values()).map((cluster) => cluster.send(message));
        return Promise.all(promises);
    }
    // Kills all running clusters and respawns them.
    async respawnAll({ clusterDelay = 8000, respawnDelay = 800, timeout = 30000 }) {
        this.promise.nonces.clear();
        let s = 0;
        let i = 0;
        this._debug('[ClusterManager] Respawning all clusters.');
        const promises = [];
        const listOfShardsForCluster = shardingUtils_1.ShardingUtils.chunkArray(this.options.shardList || [], this.options.shardsPerClusters || this.options.totalShards);
        for (const cluster of this.clusters.values()) {
            promises.push(cluster.respawn(respawnDelay, timeout));
            const length = listOfShardsForCluster[i]?.length || this.options.totalShards / this.options.totalClusters;
            if (++s < this.clusters.size && clusterDelay > 0)
                promises.push(shardingUtils_1.ShardingUtils.delayFor(length * clusterDelay));
            i++;
        }
        await Promise.all(promises);
        return this.clusters;
    }
    // Runs a method with given arguments on the Manager itself.
    async eval(script, options) {
        let result;
        let error;
        // Manager is not allowed to crash.
        try {
            result = await eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
        }
        catch (err) {
            error = err;
        }
        return { result: result, error: error };
    }
    // Evaluates a script on all clusters, or a given cluster, in the context of the Clients.
    async broadcastEval(script, options) {
        if (this.clusters.size === 0)
            return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned.'));
        if ((options?.cluster !== undefined || options?.shard !== undefined) && options?.guildId !== undefined)
            return Promise.reject(new Error('CLUSTERING_INVALID_OPTION | Cannot use both guildId and cluster/shard options.'));
        if (options?.cluster !== undefined) {
            const clusterIds = Array.isArray(options.cluster) ? options.cluster : [options.cluster];
            if (clusterIds.some((c) => c < 0))
                return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));
        }
        if (options?.guildId)
            options.cluster = shardingUtils_1.ShardingUtils.clusterIdForGuildId(options.guildId, this.options.totalShards, this.options.totalClusters);
        if (options?.shard !== undefined) {
            const shardIds = Array.isArray(options.shard) ? options.shard : [options.shard];
            if (shardIds.some((s) => s < 0))
                return Promise.reject(new RangeError('SHARD_ID_OUT_OF_RANGE | Shard Ids must be greater than or equal to 0.'));
            const clusterIds = new Set();
            for (const cluster of this.clusters.values()) {
                if (cluster.shardList.some((shard) => shardIds.includes(shard)))
                    clusterIds.add(cluster.id);
            }
            if (clusterIds.size === 0)
                return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | No clusters found for the given shard Ids.'));
            else if (clusterIds.size === 1)
                options.cluster = clusterIds.values().next().value;
            else
                options.cluster = Array.from(clusterIds);
        }
        const promises = [];
        if (typeof options?.cluster === 'number') {
            const cluster = this.clusters.get(options.cluster);
            if (!cluster)
                return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | No cluster was found with the given Id.'));
            promises.push(cluster.evalOnClient(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`));
        }
        else if (Array.isArray(options?.cluster)) {
            const clusters = Array.from(this.clusters.values()).filter((c) => options?.cluster?.includes(c.id));
            if (clusters.length === 0)
                return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | No clusters were found with the given Ids.'));
            for (const cluster of clusters) {
                promises.push(cluster.evalOnClient(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`));
            }
        }
        else {
            for (const cluster of this.clusters.values()) {
                promises.push(cluster.evalOnClient(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`));
            }
        }
        return Promise.all(promises);
    }
    async broadcastEvalWithCustomInstances(script, options, customInstances) {
        if (this.clusters.size === 0)
            return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned.'));
        const promises = [];
        for (const cluster of this.clusters.values()) {
            promises.push({
                isCustomInstance: false,
                result: await cluster.evalOnClient(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`),
            });
        }
        for (const customInstance of customInstances || []) {
            if ((!customInstance)._eval)
                customInstance._eval = function (_) { return eval(_); }.bind(customInstance);
            promises.push({
                isCustomInstance: true,
                result: await customInstance._eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`),
            });
        }
        return (await Promise.all(promises.map((p) => p.result))).map((result, i) => ({ isCustomInstance: promises[i].isCustomInstance, result: result }));
    }
    // Runs a method with given arguments on a given Cluster's Client.
    async evalOnClusterClient(cluster, script, options) {
        if (this.clusters.size === 0)
            return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned.'));
        if (typeof cluster !== 'number' || cluster < 0)
            return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));
        const cl = this.clusters.get(cluster);
        if (!cl)
            return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | Cluster with id ' + cluster + ' was not found.'));
        return cl.evalOnClient(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
    }
    // Runs a method with given arguments on a given Cluster's process.
    async evalOnCluster(cluster, script, options) {
        if (this.clusters.size === 0)
            return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned.'));
        if (typeof cluster !== 'number' || cluster < 0)
            return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));
        const cl = this.clusters.get(cluster);
        if (!cl)
            return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | Cluster with id ' + cluster + ' was not found.'));
        return cl.eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
    }
    // Runs a method with given arguments on a given Cluster's process and Guild.
    async evalOnGuild(guildId, script, options) {
        if (this.clusters.size === 0)
            return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned.'));
        if (typeof guildId !== 'string')
            return Promise.reject(new TypeError('CLUSTERING_GUILD_ID_INVALID | Guild Ids must be a string.'));
        return this.broadcastEval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''}, this?.guilds?.cache?.get('${guildId}'))`, {
            ...options, guildId,
        }).then((e) => e?.[0]);
    }
    // Creates a new cluster. (Using this method is usually not necessary if you use the spawn method.)
    createCluster(id, shardsToSpawn, recluster = false) {
        const cluster = new cluster_1.Cluster(this, id, shardsToSpawn);
        if (!recluster)
            this.clusters.set(id, cluster);
        // Emitted upon creating a cluster.
        this.emit('clusterCreate', cluster);
        this.heartbeat.getClusterStats(id);
        return cluster;
    }
    // Triggers a maintenance mode for all clusters.
    triggerMaintenance(reason) {
        this._debug('[ClusterManager] Triggering maintenance mode for all clusters.');
        this.maintenance = reason;
        for (const cluster of this.clusters.values()) {
            cluster.triggerMaintenance(reason);
        }
    }
    // Logs out the Debug Messages.
    _debug(message) {
        this.emit('debug', message);
        return message;
    }
}
exports.ClusterManager = ClusterManager;
//# sourceMappingURL=clusterManager.js.map