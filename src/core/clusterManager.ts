import { Awaitable, ClusterHeartbeatOptions, ClusterManagerCreateOptions, ClusterManagerEvents, ClusterManagerOptions, ClusteringMode, EvalOptions, Serialized, ValidIfSerializable, Serializable, SerializableInput } from '../types';
import { ReClusterManager } from '../plugins/reCluster';
import { HeartbeatManager } from '../plugins/heartbeat';
import { ShardingUtils } from '../other/shardingUtils';
import { IPCBrokerManager } from '../handlers/broker';
import { PromiseHandler } from '../handlers/promise';
import { Cluster, RefCluster } from './cluster';
import { RefShardingClient } from './client';
import { Queue } from '../handlers/queue';
import CustomMap from '../other/map';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';
import os from 'os';
import fs from 'fs';

/** Manager for the Clusters. */
export class ClusterManager<
	InternalClient extends RefShardingClient = RefShardingClient,
	InternalCluster extends RefCluster = RefCluster
> extends EventEmitter {
	/** Check if all clusters are ready. */
	public ready: boolean;
	/** IPC Broker for the ClusterManager. */
	readonly broker: IPCBrokerManager;
	/** Options for the ClusterManager */
	readonly options: ClusterManagerOptions<ClusteringMode>;
	/** Promise Handler for the ClusterManager */
	readonly promise: PromiseHandler;
	/** A collection of all clusters the manager spawned. */
	readonly clusters: CustomMap<number, InternalCluster>;
	/** ReCluster Manager for the ClusterManager */
	readonly reCluster: ReClusterManager;
	/** Heartbeat Manager for the ClusterManager */
	readonly heartbeat: HeartbeatManager | null;
	/** Queue for the ClusterManager */
	readonly clusterQueue: Queue;

	/** Creates an instance of ClusterManager. */
	constructor (public file: string, options: ClusterManagerCreateOptions<ClusteringMode>) {
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
			heartbeat: ShardingUtils.mergeObjects<Required<ClusterHeartbeatOptions>>(options.heartbeat || {}, {
				enabled: true,
				timeout: 8000,
				interval: 2000,
				maxRestarts: -1,
				maxMissedHeartbeats: 2,
			}),
			packageType: null,
			mode: options.mode || 'worker',
			shardList: [], clusterList: [],
			spawnOptions: {
				timeout: options.spawnOptions?.timeout ?? -1,
				delay: options.spawnOptions?.delay ?? 7000,
			},
		};

		process.env.TOTAL_SHARDS = String(options.totalShards);
		process.env.CLUSTER_COUNT = String(options.totalClusters);
		process.env.CLUSTER_MANAGER_MODE = options.mode;
		process.env.DISCORD_TOKEN = String(options.token) || undefined;
		process.env.CLUSTER_QUEUE_MODE = options.queueOptions?.mode ?? 'auto';

		this.ready = false;
		this.clusters = new CustomMap();

		this.promise = new PromiseHandler(this);
		this.broker = new IPCBrokerManager(this);
		this.reCluster = new ReClusterManager(this);
		this.heartbeat = this.options.heartbeat.enabled ? new HeartbeatManager(this) : null;

		this.clusterQueue = new Queue(this.options.queueOptions || {
			mode: 'auto', timeout: this.options.spawnOptions.timeout || -1,
		});

		this._debug('[ClusterManager] Initialized successfully.');
	}

	/** Spawns multiple internal clusters. */
	public async spawn(): Promise<Queue> {
		if (this.options.spawnOptions.delay < 6000) process.emitWarning('Spawn Delay is smaller than 6s, this can cause global rate limits on /gateway/bot', {
			code: 'SHARDING_DELAY',
		});

		if (this.options.token) {
			if (this.options.token?.includes('Bot ') || this.options.token?.includes('Bearer ')) this.options.token = this.options.token.slice(this.options.token.indexOf(' ') + 1);
			else this.options.token = this.options.token.trim();
		}

		const cpuCores = os.cpus().length;
		this.options.totalShards = this.options.totalShards !== -1 ? this.options.totalShards : this.options.token ? await ShardingUtils.getRecommendedShards(this.options.token) || 1 : 1;

		if (this.options.totalClusters === -1) {
			if (this.options.totalShards < 1) this.options.totalClusters = cpuCores;
			else {
				const idealClusters = Math.max(Math.ceil(this.options.totalShards / 7), Math.min(cpuCores, this.options.totalShards));
				this.options.totalClusters = idealClusters;
			}
		}

		this.options.shardsPerClusters = (this.options.shardsPerClusters === -1) ? Math.ceil(this.options.totalShards / this.options.totalClusters) : this.options.shardsPerClusters;

		if (this.options.totalShards < 1) this.options.totalShards = 1;
		if (this.options.totalClusters < 1) this.options.totalClusters = 1;

		if (this.options.totalClusters > this.options.totalShards) {
			this._debug(`[ClusterManager] Warning: More clusters (${this.options.totalClusters}) than shards (${this.options.totalShards}). Adjusting clusters to match shards.`);
			this.options.totalClusters = this.options.totalShards;
		}

		if (this.options.shardsPerClusters > this.options.totalShards) {
			console.warn('[ClusterManager] Shards Per Cluster is bigger than Total Shards, setting it to Total Shards.');
			this.options.shardsPerClusters = this.options.totalShards;
		} else if (this.options.shardsPerClusters > (this.options.totalShards / this.options.totalClusters)) {
			console.warn('[ClusterManager] Shards Per Cluster is bigger than optimal distribution, adjusting to optimal value.');
			this.options.shardsPerClusters = Math.ceil(this.options.totalShards / this.options.totalClusters);
		}

		if (this.options.totalClusters > cpuCores * 2) {
			console.warn(`[ClusterManager] Warning: Running ${this.options.totalClusters} clusters on ${cpuCores} CPU cores. This may impact performance. Consider reducing clusters or upgrading hardware.`);
		}

		if (this.options.mode === 'worker' && this.options.totalClusters > cpuCores * 4) {
			console.warn(`[ClusterManager] Warning: ${this.options.totalClusters} worker threads may cause thread pool exhaustion. Consider using 'process' mode or reducing clusters.`);
		}

		if (!this.options.shardList?.length) this.options.shardList = new Array(this.options.totalShards).fill(0).map((_, i) => i);
		if (this.options.shardsPerClusters) this.options.totalClusters = Math.ceil((this.options.shardList?.length || 0) / this.options.shardsPerClusters) || 1;

		if (!this.options.clusterList?.length) this.options.clusterList = new Array(this.options.totalClusters).fill(0).map((_, i) => i);
		if (this.options.clusterList.length !== this.options.totalClusters) this.options.totalClusters = this.options.clusterList.length;

		if (this.options.shardsPerClusters < 1) throw new Error('CLIENT_INVALID_OPTION | Shards Per Cluster must be at least 1.');
		if (this.options.totalShards < this.options.shardList.length) throw new Error('CLIENT_INVALID_OPTION | Shard List is bigger than Total Shards.');
		if (this.options.totalClusters < this.options.clusterList.length) throw new Error('CLIENT_INVALID_OPTION | Cluster List is bigger than Total Clusters.');
		if (this.options.shardList.some((shard) => shard < 0)) throw new Error('CLIENT_INVALID_OPTION | Shard List has invalid shards.');
		if (this.options.clusterList.some((cluster) => cluster < 0)) throw new Error('CLIENT_INVALID_OPTION | Cluster List has invalid clusters.');

		this._debug(`[ClusterManager] Spawning ${this.options.totalClusters} clusters with ${this.options.totalShards} shards in total (${this.options.shardsPerClusters} shards per cluster)`);

		const listOfShardsForCluster = ShardingUtils.chunkArray(this.options.shardList || [], this.options.shardsPerClusters || this.options.totalShards);
		if (listOfShardsForCluster.length !== this.options.totalClusters) this.options.totalClusters = listOfShardsForCluster.length;

		this.options.totalShards = listOfShardsForCluster.reduce((acc, curr) => acc + curr.length, 0);
		this.options.totalClusters = listOfShardsForCluster.length;
		this.options.shardsPerClusters = Math.ceil(this.options.totalShards / this.options.totalClusters);

		for (let i = 0; i < this.options.totalClusters; i++) {
			if (listOfShardsForCluster[i]) {
				this._debug(`[ClusterManager] Added Cluster ${this.options.clusterList?.[i] || i} to the queue with ${listOfShardsForCluster[i]} shards.`);

				this.clusterQueue.add({
					timeout: this.options.spawnOptions.delay * (listOfShardsForCluster[i]?.length ?? 0),
					args: [this.options.spawnOptions.timeout !== -1 ? this.options.spawnOptions.timeout + this.options.spawnOptions.delay * (listOfShardsForCluster[i]?.length ?? 0) : this.options.spawnOptions.timeout],
					run: (...timeout: number[]) => this.createCluster(this.options.clusterList?.[i] || i, listOfShardsForCluster[i] || []).spawn(...timeout),
				});
			}
		}

		return this.clusterQueue.start();
	}

	/** Sends a message to all clusters. */
	public async broadcast<T extends Serializable>(message: SerializableInput<T>, ignoreClusters?: number[]): Promise<void> {
		const clusters = Array.from(this.clusters.values()).filter((c) => !ignoreClusters?.includes(c.id));
		const promises = Array.from(clusters).map((cluster) => cluster.send(message));

		await Promise.allSettled(promises);
		return;
	}

	/** Kills all running clusters and respawns them. */
	public async respawnAll(clusterDelay: number = 8000, respawnDelay: number = 5500, timeout: number = -1, except: number[] = []): Promise<Map<number, InternalCluster>> {
		this.promise.nonces.clear();
		this._debug('[ClusterManager] Respawning all clusters.');

		const listOfShardsForCluster = ShardingUtils.chunkArray(
			this.options.shardList || [],
			this.options.shardsPerClusters || this.options.totalShards,
		);

		const clustersToRestart = Array.from(this.clusters.values()).filter((c) => !except.includes(c.id));
		if (clustersToRestart.length === 0) return this.clusters;

		let i = 0;

		while (clustersToRestart.length > 0) {
			const cluster = clustersToRestart.shift();
			if (!cluster) continue;

			this._debug(`Respawning cluster ${cluster.id}`);
			await cluster.respawn(respawnDelay, timeout);

			const length = listOfShardsForCluster[i]?.length || this.options.totalShards / this.options.totalClusters;
			if (clusterDelay > 0) {
				this._debug(`Delaying ${length * clusterDelay}ms for cluster ${cluster.id}`);
				await ShardingUtils.delayFor(length * clusterDelay);
			}

			i++;
		}

		return this.clusters;
	}

	/** Kills specific clusters and respawns them. */
	public async respawnClusters(clusters: number[], clusterDelay: number = 8000, respawnDelay: number = 5500, timeout: number = -1): Promise<Map<number, InternalCluster>> {
		this.promise.nonces.clear();
		this._debug('[ClusterManager] Respawning specific clusters.');

		const listOfShardsForCluster = ShardingUtils.chunkArray(
			this.options.shardList || [],
			this.options.shardsPerClusters || this.options.totalShards,
		);

		const clustersToRestart = Array.from(this.clusters.values()).filter((c) => clusters.includes(c.id));
		if (clustersToRestart.length === 0) return this.clusters;

		let i = 0;

		for (const cluster of clustersToRestart) {
			this._debug(`Respawning cluster ${cluster.id}`);
			await cluster.respawn(respawnDelay, timeout);

			const length = listOfShardsForCluster[i]?.length || this.options.totalShards / this.options.totalClusters;
			if (clusterDelay > 0 && clustersToRestart.length > 1) {
				this._debug(`Delaying ${length * clusterDelay}ms for cluster ${cluster.id}`);
				await ShardingUtils.delayFor(length * clusterDelay);
			}

			i++;
		}

		return this.clusters;
	}

	/** Evaluates a script on the Manager. */
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

	/** Evaluates a script on all clusters, or a given cluster, in the context of the Client. */
	public async broadcastEval<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>[]> {
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

		if (options?.useAllSettled || this.options.advanced?.proceedBroadcastIfClusterDead) {
			const results = (await Promise.allSettled(promises)).filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<ValidIfSerializable<T>>[];
			return results.map((r) => r.value);
		} else {
			return Promise.all(promises);
		}
	}

	/** Evaluates a script on a given Cluster's Client. */
	public async evalOnClusterClient<T, P extends object, C = InternalClient>(cluster: number, script: ((client: C, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>> {
		if (this.clusters.size === 0) return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned (#2).'));
		else if (typeof cluster !== 'number' || cluster < 0) return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));

		const cl = this.clusters.get(cluster);

		if (!cl) return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | Cluster with id ' + cluster + ' was not found (#1).'));
		return cl.evalOnClient<T, P, C>(script, options);
	}

	/** Evaluates a script on a given Cluster. */
	public async evalOnCluster<T, P extends object, C = InternalCluster>(cluster: number, script: string | ((cluster: C, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>> {
		if (this.clusters.size === 0) return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned (#3).'));
		else if (typeof cluster !== 'number' || cluster < 0) return Promise.reject(new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster Ids must be greater than or equal to 0.'));

		const cl = this.clusters.get(cluster);

		if (!cl) return Promise.reject(new Error('CLUSTERING_CLUSTER_NOT_FOUND | Cluster with id ' + cluster + ' was not found (#2).'));
		return cl.eval<T, P, C>(script, options);
	}

	/** Evaluates a script on specific guild. */
	public async evalOnGuild<T, P extends object, C = InternalClient>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild: Guild | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		if (this.clusters.size === 0) return Promise.reject(new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned (#4).'));
		else if (typeof guildId !== 'string') return Promise.reject(new TypeError('CLUSTERING_GUILD_ID_INVALID | Guild Id must be a string.'));
		else if (this.options.packageType !== 'discord.js') return Promise.reject(new Error('CLUSTERING_EVAL_GUILD_UNSUPPORTED | evalOnGuild is only supported in discord.js package type.'));

		return this.broadcastEval<T, P>(ShardingUtils.parseInput(script, options?.context, `this?.guilds?.cache?.get('${guildId}')`), { ...options, guildId }).then((e) => e?.find((r) => r !== undefined)) as Promise<ValidIfSerializable<T>>;
	}

	/** Creates a new cluster. (Using this method is usually not necessary if you use the spawn method.) */
	public createCluster(id: number, shardsToSpawn: number[], recluster: boolean = false): Cluster<this> {
		const cluster = new Cluster(this, id, shardsToSpawn);
		if (!recluster) this.clusters.set(id, cluster as unknown as InternalCluster);

		this.emit('clusterCreate', cluster);
		this.heartbeat?.getClusterStats(id);

		return cluster;
	}

	/** Logs out the Debug Messages. */
	public _debug(message: string): void {
		this.emit('debug', message);
	}
}

export type RefClusterManager = ClusterManager;

export declare interface ClusterManager {
	/** Emit an event. */
	emit: (<K extends keyof ClusterManagerEvents>(event: K, ...args: ClusterManagerEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, ...args: unknown[]) => boolean);
	/** Remove an event listener. */
	off: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
	/** Listen for an event. */
	on: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
	/** Listen for an event once. */
	once: (<K extends keyof ClusterManagerEvents>(event: K, listener: (...args: ClusterManagerEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterManagerEvents>, listener: (...args: unknown[]) => void) => this);
	/** Remove all listeners for an event. */
	removeAllListeners: (<K extends keyof ClusterManagerEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterManagerEvents>) => this);
}
