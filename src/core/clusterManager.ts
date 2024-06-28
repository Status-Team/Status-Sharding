import {
	Awaitable,
	ClusterHeartbeatOptions,
	ClusterManagerCreateOptions,
	ClusterManagerEvents,
	ClusterManagerOptions,
	ClusteringMode,
	EvalOptions,
	Serialized,
	ValidIfSerializable,
	Serializable,
	SerializableInput,
} from '../types';
import { HeartbeatManager } from '../plugins/heartbeat';
import { ReClusterManager } from '../plugins/reCluster';
import { ShardingUtils } from '../other/shardingUtils';
import { IPCBrokerManager } from '../handlers/broker';
import { PromiseHandler } from '../handlers/promise';
import { ShardingClient } from './clusterClient';
import { ChildProcess } from 'child_process';
import { Queue } from '../handlers/queue';
import { Worker } from 'worker_threads';
import CustomMap from '../other/map';
import { Cluster } from './cluster';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Manager for the Clusters.
 * @export
 * @class ClusterManager
 * @typedef {ClusterManager}
 * @extends {EventEmitter}
 */
export class ClusterManager extends EventEmitter {
	/**
	 * Check if all clusters are ready.
	 * @type {boolean}
	 */
	public ready: boolean;
	/**
	 * Maintenance mode reason
	 * @type {string}
	 */
	public maintenance: string;

	/**
	 * IPC Broker for the ClusterManager.
	 * @readonly
	 * @type {IPCBrokerManager}
	 */
	readonly broker: IPCBrokerManager;
	/**
	 * Options for the ClusterManager
	 * @readonly
	 * @type {ClusterManagerOptions<ClusteringMode>}
	 */
	readonly options: ClusterManagerOptions<ClusteringMode>;
	/**
	 * Promise Handler for the ClusterManager
	 * @readonly
	 * @type {PromiseHandler}
	 */
	readonly promise: PromiseHandler;
	/**
	 * A collection of all clusters the manager spawned.
	 * @readonly
	 * @type {CustomMap<number, Cluster>}
	 */
	readonly clusters: CustomMap<number, Cluster>;
	/**
	 * ReCluster Manager for the ClusterManager
	 * @readonly
	 * @type {ReClusterManager}
	 */
	readonly reCluster: ReClusterManager;
	/**
	 * Heartbeat Manager for the ClusterManager
	 * @readonly
	 * @type {HeartbeatManager}
	 */
	readonly heartbeat: HeartbeatManager;
	/**
	 * Queue for the ClusterManager
	 * @readonly
	 * @type {Queue}
	 */
	readonly clusterQueue: Queue;

	/**
	 * Creates an instance of ClusterManager.
	 * @constructor
	 * @param {string} file - Path to the file that will be spawned.
	 * @param {ClusterManagerCreateOptions<ClusteringMode>} options - Options for the ClusterManager.
	 */
	constructor(public file: string, options: ClusterManagerCreateOptions<ClusteringMode>) {
		super();

		if (!file) throw new Error('CLIENT_INVALID_OPTION | No File specified.');
		this.file = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);

		if (!fs.statSync(this.file)?.isFile()) throw new Error('CLIENT_INVALID_OPTION | Provided file is not an actual file.');
		else if (options.mode && options.mode !== 'worker' && options.mode !== 'process') throw new RangeError('CLIENT_INVALID_OPTION | Cluster mode must be "worker" or "process".');

		this.options = {
			...options,
			totalShards: options.totalShards === undefined ? -1 : options.totalShards,
			totalClusters: options.totalClusters === undefined ? -1 : options.totalClusters,
			shardsPerClusters: options.shardsPerClusters === undefined ? -1 : options.shardsPerClusters,
			respawn: options.respawn === undefined ? true : options.respawn,
			heartbeat: ShardingUtils.mergeObjects<Required<ClusterHeartbeatOptions>>(options.heartbeat || {}, { maxRestarts: 3, interval: 30000, timeout: 45000, maxMissedHeartbeats: 4 }),
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
		this.maintenance = '';
		this.clusters = new CustomMap();

		this.promise = new PromiseHandler(this);
		this.broker = new IPCBrokerManager(this);
		this.reCluster = new ReClusterManager(this);
		this.heartbeat = new HeartbeatManager(this);

		this.clusterQueue = new Queue(this.options.queueOptions || {
			mode: 'auto', timeout: this.options.spawnOptions.timeout || 30000,
		});

		this._debug('[ClusterManager] Initialized successfully.');
	}

	/**
	 * Spawns multiple internal clusters.
	 * @async
	 * @returns {Promise<Queue>} The queue, which is used to spawn the clusters.
	 */
	public async spawn(): Promise<Queue> {
		if (this.options.spawnOptions.delay < 8000) process.emitWarning('Spawn Delay is smaller than 8s, this can cause global rate limits on /gateway/bot', {
			code: 'SHARDING_DELAY',
		});

		if (this.options.token && this.options.token?.includes('Bot ') || this.options.token?.includes('Bearer ')) this.options.token = this.options.token.slice(this.options.token.indexOf(' ') + 1);

		const cpuCores = os.cpus().length;
		this.options.totalShards = this.options.totalShards !== -1 ? this.options.totalShards : this.options.token ? await ShardingUtils.getRecommendedShards(this.options.token) || 1 : 1;
		this.options.totalClusters = (this.options.totalClusters === -1) ? (cpuCores > this.options.totalShards ? this.options.totalShards : cpuCores) : this.options.totalClusters;
		this.options.shardsPerClusters = (this.options.shardsPerClusters === -1) ? Math.ceil(this.options.totalShards / this.options.totalClusters) : this.options.shardsPerClusters;

		if (this.options.totalShards < 1) this.options.totalShards = 1;
		if (this.options.totalClusters < 1) this.options.totalClusters = 1;

		else if (this.options.totalClusters > this.options.totalShards) throw new Error('CLIENT_INVALID_OPTION | Total Clusters cannot be more than Total Shards.');
		else if (this.options.shardsPerClusters > this.options.totalShards) throw new Error('CLIENT_INVALID_OPTION | Shards per Cluster cannot be more than Total Shards.');
		else if (this.options.shardsPerClusters > (this.options.totalShards / this.options.totalClusters)) throw new Error('CLIENT_INVALID_OPTION | Shards per Cluster cannot be more than Total Shards divided by Total Clusters.');

		if (!this.options.shardList?.length) this.options.shardList = new Array(this.options.totalShards).fill(0).map((_, i) => i);
		if (this.options.shardsPerClusters) this.options.totalClusters = Math.ceil((this.options.shardList?.length || 0) / this.options.shardsPerClusters) || 1;

		if (!this.options.clusterList?.length) this.options.clusterList = new Array(this.options.totalClusters).fill(0).map((_, i) => i);
		if (this.options.clusterList.length !== this.options.totalClusters) this.options.totalClusters = this.options.clusterList.length;

		else if (this.options.shardsPerClusters < 1) throw new Error('CLIENT_INVALID_OPTION | Shards Per Cluster must be at least 1.');
		else if (this.options.totalShards < this.options.shardList.length) throw new Error('CLIENT_INVALID_OPTION | Shard List is bigger than Total Shards.');
		else if (this.options.totalClusters < this.options.clusterList.length) throw new Error('CLIENT_INVALID_OPTION | Cluster List is bigger than Total Clusters.');

		else if (this.options.shardList.some((shard) => shard < 0)) throw new Error('CLIENT_INVALID_OPTION | Shard List has invalid shards.');
		else if (this.options.clusterList.some((cluster) => cluster < 0)) throw new Error('CLIENT_INVALID_OPTION | Cluster List has invalid clusters.');

		this._debug(`[ClusterManager] Spawning ${this.options.totalClusters} Clusters with ${this.options.totalShards} Shards.`);

		const listOfShardsForCluster = ShardingUtils.chunkArray(this.options.shardList || [], this.options.shardsPerClusters || this.options.totalShards);
		if (listOfShardsForCluster.length !== this.options.totalClusters) this.options.totalClusters = listOfShardsForCluster.length;

		this.options.totalShards = listOfShardsForCluster.reduce((acc, curr) => acc + curr.length, 0);
		this.options.totalClusters = listOfShardsForCluster.length;
		this.options.shardsPerClusters = Math.ceil(this.options.totalShards / this.options.totalClusters);

		for (let i = 0; i < this.options.totalClusters; i++) {
			if (listOfShardsForCluster[i]) {
				this._debug(`[ClusterManager] Added Cluster ${this.options.clusterList?.[i] || i} to the queue with ${listOfShardsForCluster[i]} shards.`);

				this.clusterQueue.add({
					timeout: this.options.spawnOptions.delay * listOfShardsForCluster[i]?.length,
					args: [this.options.spawnOptions.timeout !== -1 ? this.options.spawnOptions.timeout + this.options.spawnOptions.delay * listOfShardsForCluster[i]?.length : this.options.spawnOptions.timeout],
					run: (...timeout: number[]) => this.createCluster(this.options.clusterList?.[i] || i, listOfShardsForCluster[i]).spawn(...timeout),
				});
			}
		}

		return this.clusterQueue.start();
	}

	/**
	 * Sends a message to all clusters.
	 * @async
	 * @template {Serializable} T - The type of the message.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @param {?number[]} [ignoreClusters] - An array of cluster ids to ignore.
	 * @returns {Promise<void>} Resolves once all clusters have received the message.
	 */
	public async broadcast<T extends Serializable>(message: SerializableInput<T>, ignoreClusters?: number[]): Promise<void> {
		const clusters = Array.from(this.clusters.values()).filter((c) => !ignoreClusters?.includes(c.id));
		const promises = Array.from(clusters).map((cluster) => cluster.send(message));

		await Promise.allSettled(promises);
		return;
	}

	/**
	 * Kills all running clusters and respawns them.
	 * @async
	 * @param {number} [clusterDelay=8000] - The delay between each cluster respawn.
	 * @param {number} [respawnDelay=800] - The delay between each shard respawn.
	 * @param {number} [timeout=30000] - The timeout for each respawn.
	 * @returns {Promise<Map<number, Cluster>>} A collection of all clusters.
	 */
	public async respawnAll(clusterDelay: number = 8000, respawnDelay: number = 800, timeout: number = 30000): Promise<Map<number, Cluster>> {
		let s = 0; let i = 0;
		this.promise.nonces.clear();
		this._debug('[ClusterManager] Respawning all clusters.');

		const promises: Promise<ChildProcess | Worker | void>[] = [];
		const listOfShardsForCluster = ShardingUtils.chunkArray(this.options.shardList || [], this.options.shardsPerClusters || this.options.totalShards);

		for (const cluster of this.clusters.values()) {
			promises.push(cluster.respawn(respawnDelay, timeout));

			const length = listOfShardsForCluster[i]?.length || this.options.totalShards / this.options.totalClusters;
			if (++s < this.clusters.size && clusterDelay > 0) promises.push(ShardingUtils.delayFor(length * clusterDelay));

			i++;
		}

		await Promise.allSettled(promises);
		return this.clusters;
	}

	/**
	 * Evaluates a script on the Manager.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [M=ClusterManager] - The type of the manager.
	 * @param {(string | ((manager: M, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?{ context?: P, timeout?: number }} [options] - The options for the evaluation.
	 * @returns {Promise<{ result: Serialized<T> | undefined; error: Error | undefined; }>} The result of the evaluation.
	 * @example
	 * manager.eval('this.options.token').then((result) => console.log(result));
	 * manager.eval((manager) => manager.options.token).then((result) => console.log(result));
	 */
	public async eval<T, P extends object, M = ClusterManager>(script: string | ((manager: M, context: Serialized<P>) => Awaitable<T>), options?: { context?: P, timeout?: number }): Promise<{
		result: Serialized<T> | undefined;
		error: Error | undefined;
	}> {
		let result: Serialized<T> | undefined;
		let error: Error | undefined;

		// Manager is not allowed to crash.
		try {
			result = await eval(typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`);
		} catch (err) {
			error = err as Error;
		}

		return { result: result, error: error };
	}

	/**
	 * Evaluates a script on all clusters, or a given cluster, in the context of the Client.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [C=ShardingClient] - The type of the client.
	 * @param {(string | ((client: C, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?EvalOptions<P>} [options] - The options for the evaluation.
	 * @returns {Promise<ValidIfSerializable<T>[]>} The result of the evaluation.
	 */
	public async broadcastEval<T, P extends object, C = ShardingClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>[]> {
		if (this.clusters.size === 0) return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned (#1).'));
		else if ((options?.cluster !== undefined || options?.shard !== undefined) && options?.guildId !== undefined) return Promise.reject(new Error('CLUSTERING_INVALID_OPTION | Cannot use both guildId and cluster/shard options.'));

		if (options?.cluster !== undefined) {
			const clusterIds = Array.isArray(options.cluster) ? options.cluster : [options.cluster];
			if (clusterIds.some((c) => c < 0)) return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));
		}

		if (options?.guildId) options.cluster = await new Promise<number>((resolve) => resolve(ShardingUtils.clusterIdForGuildId(options.guildId!, this.options.totalShards, this.options.totalClusters))).catch(() => undefined);

		if (options?.shard !== undefined) {
			const shardIds = Array.isArray(options.shard) ? options.shard : [options.shard];
			if (shardIds.some((s) => s < 0)) return Promise.reject(new RangeError('SHARD_ID_OUT_OF_RANGE | Shard Ids must be greater than or equal to 0.'));

			const clusterIds = new Set<number>();
			for (const cluster of this.clusters.values()) {
				if (cluster.shardList.some((shard) => shardIds.includes(shard))) clusterIds.add(cluster.id);
			}

			if (clusterIds.size === 0) return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | No clusters found for the given shard Ids.'));

			if (clusterIds.size === 1) options.cluster = clusterIds.values().next().value;
			else options.cluster = Array.from(clusterIds);
		}

		const promises: Promise<ValidIfSerializable<T>>[] = [];
		if (typeof options?.cluster === 'number') {
			const cluster = this.clusters.get(options.cluster);
			if (!cluster) return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | No cluster was found with the given Id.'));

			promises.push(cluster.evalOnClient<T, P, C>(script, options));
		} else if (Array.isArray(options?.cluster)) {
			const clusters = Array.from(this.clusters.values()).filter((c) => (options?.cluster as number[])?.includes(c.id));
			if (clusters.length === 0) return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | No clusters were found with the given Ids.'));

			for (const cluster of clusters) {
				promises.push(cluster.evalOnClient<T, P, C>(script, options));
			}
		} else {
			for (const cluster of this.clusters.values()) {
				promises.push(cluster.evalOnClient<T, P, C>(script, options));
			}
		}

		if (options?.useAllSettled) {
			const results = (await Promise.allSettled(promises)).filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<ValidIfSerializable<T>>[];
			return results.map((r) => r.value);
		} else {
			return Promise.all(promises);
		}
	}

	/**
	 * Evaluates a script on a given Cluster's Client.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [C=ShardingClient] - The type of the client.
	 * @param {number} cluster - The cluster to run the method on.
	 * @param {(string | ((client: C, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?Exclude<EvalOptions<P>, 'cluster'>} [options] - The options for the evaluation.
	 * @returns {Promise<ValidIfSerializable<T>>} The result of the evaluation.
	 */
	public async evalOnClusterClient<T, P extends object, C = ShardingClient>(cluster: number, script: ((client: C, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>> {
		if (this.clusters.size === 0) return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned (#2).'));
		else if (typeof cluster !== 'number' || cluster < 0) return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));

		const cl = this.clusters.get(cluster);

		if (!cl) return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | Cluster with id ' + cluster + ' was not found (#1).'));
		return cl.evalOnClient<T, P, C>(script, options);
	}

	/**
	 * Evaluates a script on a given Cluster.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @param {number} cluster - The cluster to run the method on.
	 * @param {(string | ((cluster: Cluster, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?Exclude<EvalOptions<P>, 'cluster'>} [options] - The options for the evaluation.
	 * @returns {Promise<ValidIfSerializable<T>>} The result of the evaluation.
	 */
	public async evalOnCluster<T, P extends object>(cluster: number, script: string | ((cluster: Cluster, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>> {
		if (this.clusters.size === 0) return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned (#3).'));
		else if (typeof cluster !== 'number' || cluster < 0) return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));

		const cl = this.clusters.get(cluster);

		if (!cl) return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | Cluster with id ' + cluster + ' was not found (#2).'));
		return cl.eval<T, P>(script, options);
	}

	/**
	 * Evaluates a script on specific guild.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [C=ShardingClient] - The type of the client.
	 * @template {boolean} [E=false] - Whether to use experimental mode.
	 * @param {string} guildId - The ID of the guild to use.
	 * @param {((client: C, context: Serialized<P>, guild: Guild) => Awaitable<T>)} script - The script to evaluate.
	 * @param {?{ context?: P; timeout?: number; experimental?: E; }} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>>} The result of the evaluation.
	 */
	public async evalOnGuild<T, P extends object, C = ShardingClient, E extends boolean = false>(guildId: string, script: (client: C, context: Serialized<P>, guild: E extends true ? Guild : Guild | undefined) => Awaitable<T>, options?: { context?: P; timeout?: number; experimental?: E; }): Promise<ValidIfSerializable<T>> {
		if (this.clusters.size === 0) return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned (#4).'));
		else if (typeof guildId !== 'string') return Promise.reject(new TypeError('CLUSTERING_GUILD_ID_INVALID | Guild Id must be a string.'));

		return this.broadcastEval<T, P>(`(${options?.experimental ? ShardingUtils.guildEvalParser(script) : script})(this,${options?.context ? JSON.stringify(options.context) : undefined},this?.guilds?.cache?.get('${guildId}'))`, {
			...options, guildId,
		}).then((e) => e?.find((r) => r !== undefined)) as Promise<ValidIfSerializable<T>>;
	}

	/**
	 * Creates a new cluster. (Using this method is usually not necessary if you use the spawn method.)
	 * @param {number} id - The id of the cluster.
	 * @param {number[]} shardsToSpawn - The shards to spawn for the cluster.
	 * @param {boolean} [recluster=false] - Whether the cluster is a recluster.
	 * @returns {Cluster} The created cluster.
	 */
	public createCluster(id: number, shardsToSpawn: number[], recluster: boolean = false): Cluster {
		const cluster = new Cluster(this, id, shardsToSpawn);
		if (!recluster) this.clusters.set(id, cluster);

		this.emit('clusterCreate', cluster);
		this.heartbeat.getClusterStats(id);

		return cluster;
	}

	/**
	 * Triggers a maintenance mode for all clusters.
	 * @param {string} reason - The reason for the maintenance mode.
	 * @returns {void} Nothing.
	 */
	public triggerMaintenance(reason: string): void {
		this._debug('[ClusterManager] Triggering maintenance mode for all clusters.');

		this.maintenance = reason;
		for (const cluster of this.clusters.values()) {
			cluster.triggerMaintenance(reason);
		}
	}

	/**
	 * Logs out the Debug Messages.
	 * @param {string} message - The message to log.
	 * @returns {void} Nothing.
	 */
	public _debug(message: string): void {
		this.emit('debug', message);
	}
}

// Credits for EventEmitter typings: https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/RequestManager.ts#L159
/**
 * ClusterManager Events.
 * @export
 * @interface ClusterManager
 * @typedef {ClusterManager}
 */
export declare interface ClusterManager {
	/**
	 * Emit an event.
	 * @type {(<K extends keyof ClusterManagerEvents>(event: K, ...args: ClusterManagerEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, ...args: unknown[]) => boolean)}
	 */
	emit: (<K extends keyof ClusterManagerEvents>(event: K, ...args: ClusterManagerEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, ...args: unknown[]) => boolean);
	/**
	 * Remove an event listener.
	 * @type {(<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	off: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
	/**
	 * Listen for an event.
	 * @type {(<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	on: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
	/**
	 * Listen for an event once.
	 * @type {(<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	once: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
	/**
	 * Remove all listeners for an event.
	 * @type {(<K extends keyof ClusterManagerEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterManagerEvents>) => this)}
	 */
	removeAllListeners: (<K extends keyof ClusterManagerEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterManagerEvents>) => this);
}
