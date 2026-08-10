import { MessageTypes, type BaseMessage, type ClusterManagerCreateOptions, type ClusterManagerOptions, type DataType, type EvalOptions, type RefCluster, type Serializable, type SerializableInput, type Serialized, type ValidIfSerializable, type Awaitable, type ClientRefType, type ClusterManagerEvents, type ClusterLifecycleRecord } from '../types.js';
import { ProcessMessage, isBaseMessage } from '../other/message.js';
import { ReClusterManager } from '../plugins/reCluster.js';
import { HeartbeatManager } from '../plugins/heartbeat.js';
import { ShardingUtils } from '../other/shardingUtils.js';
import { IPCBrokerManager } from '../handlers/broker.js';
import { Cluster, type ClusterHost } from './cluster.js';
import { PromiseHandler } from '../handlers/promise.js';
import { Queue } from '../handlers/queue.js';
import { ClusterMap } from '../other/map.js';
import EventEmitter from 'node:events';
import path from 'node:path';
import fs from 'node:fs';

export class ClusterManager<
	InternalClient extends ClientRefType = ClientRefType,
	InternalCluster extends RefCluster<InternalClient> = RefCluster<InternalClient>,
> extends EventEmitter implements ClusterHost<InternalClient> {
	public ready = false;

	public readonly options: ClusterManagerOptions;
	public readonly clusters: ClusterMap<number, InternalCluster>;
	public readonly promise: PromiseHandler;
	public readonly broker: IPCBrokerManager;
	public readonly heartbeat: HeartbeatManager;
	public readonly reCluster: ReClusterManager;
	public readonly clusterQueue: Queue;

	private spawnPromise?: Promise<void>;
	private shuttingDown = false;
	private topologyResolved = false;
	private manualSpawnIndex = 0;

	constructor (public readonly file: string, options: ClusterManagerCreateOptions = {}) {
		super();

		const resolvedFile = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
		if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) throw new Error('CLIENT_INVALID_OPTION | Cluster file does not exist.');
		this.file = resolvedFile;
		const mode = options.mode ?? 'process';
		const heartbeatOptions = options.heartbeat ?? {};
		const spawnOptions = options.spawnOptions ?? {};
		const queueOptions = options.queueOptions ?? {};
		const advancedOptions = options.advanced ?? {};

		const heartbeat = {
			enabled: heartbeatOptions.enabled ?? true,
			interval: heartbeatOptions.interval ?? 3_000,
			timeout: heartbeatOptions.timeout ?? 12_000,
			maxMissedHeartbeats: heartbeatOptions.maxMissedHeartbeats ?? 3,
			maxRestarts: heartbeatOptions.maxRestarts ?? 5,
			restartWindow: heartbeatOptions.restartWindow ?? 15 * 60_000,
			restartBackoff: heartbeatOptions.restartBackoff ?? 5_000,
			maxRestartBackoff: heartbeatOptions.maxRestartBackoff ?? 60_000,
		};

		this.options = {
			mode,
			token: options.token,
			totalShards: options.totalShards ?? -1,
			totalClusters: options.totalClusters ?? -1,
			shardsPerClusters: options.shardsPerClusters ?? -1,
			shardArgs: options.shardArgs ?? [],
			execArgv: options.execArgv ?? [],
			respawn: options.respawn ?? true,

			heartbeat,
			spawnOptions: {
				delay: spawnOptions.delay ?? 7_000,
				timeout: spawnOptions.timeout === -1 ? 120_000 : (spawnOptions.timeout ?? 120_000),
			},
			queueOptions: { mode: queueOptions.mode ?? 'auto', timeout: queueOptions.timeout ?? 120_000 },

			clusterData: options.clusterData ?? {},
			clusterOptions: options.clusterOptions,
			advanced: {
				ipcTimeout: advancedOptions.ipcTimeout ?? 30_000,
				ipcMaxPayload: advancedOptions.ipcMaxPayload ?? 8 * 1024 * 1024,
				terminationTimeout: advancedOptions.terminationTimeout ?? 15_000,
				forceKillAfter: advancedOptions.forceKillAfter ?? 5_000,
				queueUntilReady: advancedOptions.queueUntilReady ?? false,
				logMessagesInDebug: advancedOptions.logMessagesInDebug ?? false,
			},
			packageType: null,
		};

		this.validateOptions();
		this.clusters = new ClusterMap<number, InternalCluster>();
		this.promise = new PromiseHandler(this.options.advanced.ipcTimeout, this.options.advanced.ipcMaxPayload > 0 ? 10_000 : 1);
		this.broker = new IPCBrokerManager(this);
		this.heartbeat = new HeartbeatManager(this);
		this.reCluster = new ReClusterManager(this);
		this.clusterQueue = new Queue({
			mode: this.options.queueOptions.mode,
			delay: this.options.spawnOptions.delay,
			timeout: this.options.queueOptions.timeout,
		});
	}

	private validateOptions(): void {
		const numericOptions: Array<[string, number]> = [
			['totalShards', this.options.totalShards],
			['totalClusters', this.options.totalClusters],
			['shardsPerClusters', this.options.shardsPerClusters],
		];

		for (const [name, value] of numericOptions) {
			if (value !== -1 && (!Number.isInteger(value) || value < 1)) throw new RangeError(`CLIENT_INVALID_OPTION | ${name} must be -1 or a positive integer.`);
		}

		if (this.options.token !== undefined && !this.options.token.trim()) throw new TypeError('CLIENT_INVALID_OPTION | token cannot be empty.');
		if (!Number.isFinite(this.options.spawnOptions.delay) || this.options.spawnOptions.delay < 0) throw new RangeError('CLIENT_INVALID_OPTION | Spawn delay must be non-negative.');
		if (!Number.isFinite(this.options.spawnOptions.timeout) || this.options.spawnOptions.timeout < 0) throw new RangeError('CLIENT_INVALID_OPTION | Spawn timeout must be finite and non-negative.');
		if (!Number.isFinite(this.options.queueOptions.timeout) || this.options.queueOptions.timeout < 0) throw new RangeError('CLIENT_INVALID_OPTION | Queue timeout must be non-negative.');
		if (!Number.isFinite(this.options.heartbeat.interval) || this.options.heartbeat.interval < 1) throw new RangeError('CLIENT_INVALID_OPTION | Heartbeat interval must be positive.');
		if (!Number.isFinite(this.options.heartbeat.timeout) || this.options.heartbeat.timeout < 1) throw new RangeError('CLIENT_INVALID_OPTION | Heartbeat timeout must be positive.');
		if (!Number.isInteger(this.options.heartbeat.maxMissedHeartbeats) || this.options.heartbeat.maxMissedHeartbeats < 1) throw new RangeError('CLIENT_INVALID_OPTION | maxMissedHeartbeats must be positive.');
		if (!Number.isInteger(this.options.heartbeat.maxRestarts) || (this.options.heartbeat.maxRestarts !== -1 && this.options.heartbeat.maxRestarts < 1)) throw new RangeError('CLIENT_INVALID_OPTION | maxRestarts must be positive or -1 for unlimited.');
		if (!Number.isFinite(this.options.advanced.ipcTimeout) || this.options.advanced.ipcTimeout < 1) throw new RangeError('CLIENT_INVALID_OPTION | ipcTimeout must be positive.');
		if (!Number.isInteger(this.options.advanced.ipcMaxPayload) || this.options.advanced.ipcMaxPayload < 1_024) throw new RangeError('CLIENT_INVALID_OPTION | ipcMaxPayload must be at least 1024 bytes.');
		if (!Number.isFinite(this.options.advanced.terminationTimeout) || this.options.advanced.terminationTimeout < 1) throw new RangeError('CLIENT_INVALID_OPTION | terminationTimeout must be positive.');
		if (!Number.isFinite(this.options.advanced.forceKillAfter) || this.options.advanced.forceKillAfter < 0) throw new RangeError('CLIENT_INVALID_OPTION | forceKillAfter must be non-negative.');
	}

	/* ----------------------------------- Lifecycle ----------------------------------- */

	public async spawn(): Promise<void> {
		if (this.spawnPromise) return this.spawnPromise;
		this._debug('The manager received a spawn request.');
		this.spawnPromise = this.spawnInternal().finally(() => {
			this.spawnPromise = undefined;
		});

		return this.spawnPromise;
	}

	private async spawnInternal(): Promise<void> {
		if (this.shuttingDown) throw new Error('MANAGER_SHUTTING_DOWN | Manager is shutting down.');

		await this.resolveTopology();
		this.ready = false;
		this._debug(`The manager is spawning ${this.clusters.size} clusters in ${this.options.mode} mode.`);
		this.heartbeat.start();

		const clusters = [...this.clusters.values()];
		if (this.options.queueOptions.mode === 'manual') {
			const cluster = clusters[this.manualSpawnIndex];
			if (cluster) await this.spawnCluster(cluster);
			return this.checkReady();
		}

		for (let index = 0; index < clusters.length; index += 1) {
			const cluster = clusters[index];
			if (!cluster) continue;
			await this.spawnCluster(cluster);
			if (index < clusters.length - 1 && this.options.spawnOptions.delay) await ShardingUtils.delayFor(this.options.spawnOptions.delay);
		}

		this.checkReady();
	}

	private async spawnCluster(cluster: InternalCluster): Promise<void> {
		const operation = this.clusterQueue.add(async () => {
			this._debug(`The manager is spawning cluster ${cluster.id}.`);
			this.heartbeat.reset(cluster);
			await cluster.spawn(this.options.spawnOptions.timeout);
			this._debug(`Cluster ${cluster.id} completed its spawn.`);

			if (this.options.queueOptions.mode === 'manual') this.manualSpawnIndex += 1;
		});

		if (this.options.queueOptions.mode === 'manual') await this.clusterQueue.start();
		await operation;
	}

	public async spawnNextCluster(): Promise<void> {
		await this.resolveTopology();

		if (this.options.queueOptions.mode !== 'manual') return this.spawn();
		const clusters = [...this.clusters.values()];
		if (this.manualSpawnIndex >= clusters.length) return;

		const cluster = clusters[this.manualSpawnIndex];
		if (!cluster) return;

		await this.spawnCluster(cluster);
		this.checkReady();
	}

	public resetSpawnQueue(): void {
		this.manualSpawnIndex = 0;
	}

	private async resolveTopology(): Promise<void> {
		if (this.topologyResolved) return;

		let totalShards = this.options.totalShards;
		if (totalShards === -1) {
			if (!this.options.token) totalShards = 1;
			else totalShards = (await ShardingUtils.getGatewayBotInfo(this.options.token)).shards;
		}

		let totalClusters = this.options.totalClusters;
		if (totalClusters === -1) totalClusters = this.options.shardsPerClusters > 0 ? Math.ceil(totalShards / this.options.shardsPerClusters) : 1;
		if (this.options.shardsPerClusters > 0) totalClusters = Math.max(totalClusters, Math.ceil(totalShards / this.options.shardsPerClusters));

		totalClusters = Math.min(totalClusters, totalShards);
		const shardsPerCluster = Math.ceil(totalShards / totalClusters);

		this.options.totalShards = totalShards;
		this.options.totalClusters = totalClusters;
		this.options.shardsPerClusters = shardsPerCluster;

		for (let id = 0; id < totalClusters; id += 1) {
			const start = id * shardsPerCluster;
			const shards = Array.from({ length: Math.min(shardsPerCluster, totalShards - start) }, (_, offset) => start + offset);
			if (shards.length) {
				const cluster = this.createClusterInstance(id, shards);
				this.clusters._setInternal(id, cluster);
				this.wireCluster(cluster);
				this.emitSafe('clusterCreate', cluster);
			}
		}

		this.topologyResolved = true;
		this._debug(`The manager resolved a topology of ${totalShards} shards across ${this.clusters.size} clusters.`);
	}

	/* ----------------------------------- Operations ----------------------------------- */

	protected createClusterInstance(id: number, shards: readonly number[]): InternalCluster;

	protected createClusterInstance(id: number, shards: readonly number[]): RefCluster<InternalClient> {
		return new Cluster(this, id, [...shards]);
	}

	public createCluster(id: number, shardsToSpawn: number[], _recluster = false): InternalCluster {
		this._debug(`The manager is creating cluster ${id} for shards ${shardsToSpawn.join(', ')}.`);

		const cluster = this.createClusterInstance(id, shardsToSpawn);
		this.clusters._setInternal(id, cluster);

		this.wireCluster(cluster);
		this.emitSafe('clusterCreate', cluster);

		return cluster;
	}

	private wireCluster(cluster: InternalCluster): void {
		cluster.on('lifecycle', (record) => {
			if (!isLifecycleRecord(record)) return;
			this.emitSafe('clusterLifecycle', cluster, record);
			if (record.state === 'failed') this.emitSafe('clusterDeath', cluster, record);
		});

		cluster.on('degraded', (record) => this.emitSafe('clusterLifecycle', cluster, record));
		cluster.on('restart', (record) => this.emitSafe('clusterRestart', cluster, record));
	}

	public createClusterEnvironment(cluster: RefCluster<InternalClient>): NodeJS.ProcessEnv {
		const environment: NodeJS.ProcessEnv = {
			...process.env,
			...Object.fromEntries(Object.entries(this.options.clusterData).map(([key, value]) => [key, String(value)])),

			STATUS_CLUSTER_MODE: this.options.mode,
			STATUS_CLUSTER_ID: String(cluster.id),
			STATUS_CLUSTER_COUNT: String(this.options.totalClusters),
			STATUS_TOTAL_SHARDS: String(this.options.totalShards),
			STATUS_SHARD_LIST: JSON.stringify(cluster.shardList),

			STATUS_QUEUE_MODE: this.options.queueOptions.mode,
			STATUS_QUEUE_UNTIL_READY: String(this.options.advanced.queueUntilReady),
			STATUS_IPC_TIMEOUT: String(this.options.advanced.ipcTimeout),
			STATUS_IPC_MAX_PENDING: '10000',
			STATUS_IPC_MAX_PAYLOAD: String(this.options.advanced.ipcMaxPayload),
		};

		return environment;
	}

	/* ----------------------------------- IPC ----------------------------------- */

	public async broadcast<T extends Serializable>(message: SerializableInput<T>, ignore: number[] = []): Promise<void> {
		this._debug(`The manager is broadcasting a message to ${this.clusters.size} clusters and ignoring ${ignore.length ? ignore.join(', ') : 'no clusters'}.`);
		const failures: Error[] = [];

		for (const [id, cluster] of this.clusters) {
			if (ignore.includes(id)) continue;
			try {
				await cluster.send(message);
			} catch (error: unknown) {
				failures.push(error instanceof Error ? error : new Error(String(error)));
			}
		}

		if (failures.length && !this.options.advanced.logMessagesInDebug) throw new AggregateError(failures, 'CLUSTER_BROADCAST_FAILED | One or more clusters rejected the message.');
	}

	public async eval<T, P extends object>(script: string | ((manager: this, context: Serialized<P> | undefined) => Awaitable<T>), options?: { context?: P }): Promise<ValidIfSerializable<T>> {
		if (typeof script === 'function') return await script(this, options?.context);
		return await new Function('manager', 'context', `return (${script})`).call(this, this, options?.context);
	}

	public async broadcastEval<T extends Serializable, P extends object>(script: string | ((client: InternalClient, context: Serialized<P> | undefined) => Awaitable<T>), options: EvalOptions<P> = {}): Promise<ValidIfSerializable<T>[]> {
		if (!this.clusters.size) throw new Error('CLUSTERING_NO_CLUSTERS | No clusters have been spawned.');
		if (options.guildId !== undefined && (options.cluster !== undefined || options.shard !== undefined)) throw new Error('CLUSTERING_INVALID_OPTION | Cannot use guildId with cluster or shard options.');

		const targets = this.targetClusters(options);
		if (!targets.length) throw new Error('CLUSTERING_CLUSTER_NOT_FOUND | No clusters matched the evaluation options.');

		const operations = targets.map((cluster) => cluster.evalOnClient(script, options));
		if (!options.useAllSettled) return Promise.all(operations);

		const settled = await Promise.allSettled(operations);
		return settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
	}

	public evalOnClusterClient<T, P extends object>(clusterId: number, script: string | ((client: InternalClient, context: Serialized<P> | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		const cluster = this.clusters.get(clusterId);
		if (!cluster) return Promise.reject(new Error(`CLUSTER_NOT_FOUND | Cluster ${clusterId} does not exist.`));

		return cluster.evalOnClient(script, options);
	}

	public evalOnCluster<T, P extends object>(clusterId: number, script: string | ((cluster: InternalCluster, context: Serialized<P> | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		const cluster = this.clusters.get(clusterId);
		if (!cluster) return Promise.reject(new Error(`CLUSTER_NOT_FOUND | Cluster ${clusterId} does not exist.`));

		if (typeof script === 'function') return Promise.resolve(script(cluster, options?.context));
		return cluster.eval(script, options);
	}

	public async evalOnGuild<T, P extends object>(guildId: string, script: string | ((client: InternalClient, context: Serialized<P> | undefined, guild: unknown) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		const shard = ShardingUtils.shardIdForGuildId(guildId, this.options.totalShards);
		const clusterId = ShardingUtils.clusterIdForShardId(shard, this.options.totalShards, this.options.totalClusters);

		const cluster = this.clusters.get(clusterId);
		if (!cluster) return Promise.reject(new Error(`CLUSTER_NOT_FOUND | Cluster ${clusterId} does not exist.`));

		return cluster.evalOnGuild(guildId, script, {
			...options,
			guildId,
		});
	}

	public async respawnAll(clusterDelay = 8_000, respawnDelay = this.options.spawnOptions.delay, timeout = this.options.spawnOptions.timeout, except: number[] = []): Promise<void> {
		this._debug(`The manager received a request to respawn all clusters except ${except.length ? except.join(', ') : 'none'}.`);
		this.ready = false;

		const targets = [...this.clusters].filter(([id]) => !except.includes(id));
		for (let index = 0; index < targets.length; index += 1) {
			const target = targets[index];
			if (!target) continue;
			const [, cluster] = target;

			await cluster.respawn(respawnDelay, timeout);
			if (index < targets.length - 1 && clusterDelay) await ShardingUtils.delayFor(clusterDelay);
		}

		this.checkReady();
	}

	public async respawnClusters(clusters: number[], clusterDelay = 8_000, respawnDelay = this.options.spawnOptions.delay, timeout = this.options.spawnOptions.timeout): Promise<void> {
		await this.respawnAll(clusterDelay, respawnDelay, timeout, [...this.clusters.keys()].filter((id) => !clusters.includes(id)));
	}

	public async shutdown(): Promise<void> {
		if (this.shuttingDown) return;
		this._debug('The manager received a shutdown request.');

		this.shuttingDown = true;
		this.heartbeat.stop();
		this.clusterQueue.stop();

		this.promise.rejectAll(new Error('IPC_MANAGER_SHUTTING_DOWN | The manager is shutting down before the request completed.'));
		this._debug('The manager rejected all pending IPC requests because shutdown started.');

		await Promise.all(
			Array.from(this.clusters.values()).map((cluster) =>
				cluster.kill({ lifecycleReason: 'manager-shutdown', reason: 'Manager shutdown.' }),
			),
		);

		this.ready = false;
		this.emitSafe('shutdown', this);
		this._debug('The manager completed its shutdown.');
	}

	/* ----------------------------------- Events ----------------------------------- */

	public handleClusterReady(cluster: RefCluster<InternalClient>, generation: number, packageType?: 'discord.js' | '@discordjs/core' | null): void {
		if (cluster.lifecycleState !== 'ready') return;
		this.heartbeat.reset(cluster);
		this.options.packageType = packageType ?? this.options.packageType;

		this.emitSafe('clusterReady', cluster);
		this.checkReady();
		this._debug(`Cluster ${cluster.id} generation ${generation} is ready.`);
	}

	public handleClusterMessage(cluster: RefCluster<InternalClient>, generation: number, message: unknown): Promise<void> {
		if (generation !== this.clusterGeneration(cluster) || !message || typeof message !== 'object') return Promise.resolve();
		if (!isBaseMessage(message)) return Promise.resolve();

		const wire = message;
		const heartbeat = wire._type === MessageTypes.HeartbeatAck ? heartbeatFromData(wire.data) : undefined;
		this._debug(`Cluster ${cluster.id} sent an IPC message of type ${wire._type} during generation ${generation}.`);

		switch (wire._type) {
			case MessageTypes.ClientReady:
				cluster._setReady(generation, packageTypeFromData(wire.data));
				return Promise.resolve();

			case MessageTypes.ClientUnready:
				cluster._markDegraded('client-unready');
				return Promise.resolve();

			case MessageTypes.HeartbeatAck:
				if (heartbeat) this.heartbeat.receive(cluster, heartbeat);
				return Promise.resolve();

			case MessageTypes.CustomReply:
			case MessageTypes.ClientEvalResponse:
			case MessageTypes.ClientBroadcastResponse:
			case MessageTypes.ClientManagerEvalResponse:
				if (wire._nonce) this.promise.resolve(this.promiseKey(cluster, wire._nonce), wire.data);
				return Promise.resolve();

			case MessageTypes.ClientEvalResponseError:
			case MessageTypes.ClientBroadcastResponseError:
			case MessageTypes.ClientManagerEvalResponseError:
				if (wire._nonce) this.promise.reject(this.promiseKey(cluster, wire._nonce), new Error(errorMessageFromData(wire.data)));
				return Promise.resolve();

			case MessageTypes.CustomMessage:
			case MessageTypes.CustomRequest:
				return this.handleCustomMessage(cluster, generation, wire);

			case MessageTypes.ClientManagerEvalRequest:
				return this.handleManagerEval(cluster, wire);

			case MessageTypes.ClientBroadcastRequest:
				return this.handleBroadcastEval(cluster, wire);

			case MessageTypes.ClientBroadcast:
				return this.handleClientBroadcast(wire);

			case MessageTypes.ClientRespawnAll:
				return this.respawnAllMessage(cluster, wire);

			case MessageTypes.ClientRespawnSpecific:
				return this.respawnSpecificMessage(cluster, wire);

			case MessageTypes.ClientSpawnNextCluster:
				return this.spawnNextCluster();

			default:
				return Promise.resolve();
		}
	}

	private handleCustomMessage(cluster: RefCluster<InternalClient>, generation: number, wire: BaseMessage<DataType>): Promise<void> {
		const ownedWire = { ...wire, _clusterId: cluster.id, _generation: generation };
		const processMessage = new ProcessMessage<DataType>(cluster, ownedWire, async (reply) => {
			if (generation !== this.clusterGeneration(cluster)) throw new Error(`CLUSTER_STALE_MESSAGE_REPLY | Cluster ${cluster.id} generation ${generation} is no longer active.`);
			await cluster._sendInstance(reply);
		});

		if (wire._type === MessageTypes.CustomRequest) this.emitSafe('clientRequest', processMessage);
		cluster.emit('message', processMessage);
		this.emitSafe('message', processMessage);

		return Promise.resolve();
	}

	private async handleManagerEval(cluster: RefCluster<InternalClient>, message: BaseMessage<DataType>): Promise<void> {
		if (!message._nonce) return;

		const data = evalRequestFromData(message.data);
		if (!data) return;

		try {
			const result = await new Function('manager', 'context', `return (${data.script})(manager, context)`).call(this, this, data.options?.context);

			await cluster._sendInstance({
				_type: MessageTypes.ClientManagerEvalResponse,
				_nonce: message._nonce,
				data: result,
			});
		} catch (error: unknown) {
			await cluster._sendInstance({
				_type: MessageTypes.ClientManagerEvalResponseError,
				_nonce: message._nonce,
				data: ShardingUtils.makePlainError(error),
			});
		}
	}

	private async handleBroadcastEval(cluster: RefCluster<InternalClient>, message: BaseMessage<DataType>): Promise<void> {
		if (!message._nonce) return;
		const data = evalRequestFromData(message.data);

		if (!data) return;
		const options = data.options ?? {};

		try {
			const values = await this.broadcastEval(data.script, options);
			await cluster._sendInstance({
				_type: MessageTypes.ClientBroadcastResponse,
				_nonce: message._nonce,
				data: values,
			});
		} catch (error: unknown) {
			await cluster._sendInstance({
				_type: MessageTypes.ClientBroadcastResponseError,
				_nonce: message._nonce,
				data: ShardingUtils.makePlainError(error),
			});
		}
	}

	private async handleClientBroadcast(message: BaseMessage<DataType>): Promise<void> {
		const data = clientBroadcastFromData(message.data);
		if (!data) return;
		await this.broadcast(data.message, data.ignore);
	}

	private async respawnAllMessage(_cluster: RefCluster<InternalClient>, message: BaseMessage<DataType>): Promise<void> {
		const data = respawnDataFromMessage(message.data);
		await this.respawnAll(data?.clusterDelay, data?.respawnDelay, data?.timeout, data?.except);
	}

	private async respawnSpecificMessage(_cluster: RefCluster<InternalClient>, message: BaseMessage<DataType>): Promise<void> {
		const data = respawnSpecificDataFromMessage(message.data);
		if (data) await this.respawnClusters(data.clusterIds, data.clusterDelay, data.respawnDelay, data.timeout);
	}

	public handleClusterExit(cluster: RefCluster<InternalClient>, generation: number, exitCode: number | null, signal: NodeJS.Signals | null): void {
		this._debug(`The manager observed cluster ${cluster.id} exit during generation ${generation} with code ${exitCode ?? 'null'} and signal ${signal ?? 'null'}.`);
		this.heartbeat.reset(cluster);
		cluster._unexpectedExit(generation, exitCode, signal, signal || exitCode !== null ? 'process-exit' : 'ipc-disconnect');
	}

	public rejectClusterGeneration(cluster: RefCluster<InternalClient>, generation: number, error: Error): void {
		const prefix = `${cluster.id}:${generation}:`;
		this.promise.rejectMatching((nonce) => nonce.startsWith(prefix), error);
	}

	public handleClusterError(cluster: RefCluster<InternalClient>, _generation: number, error: Error): void {
		if (error.message.startsWith('CLUSTERING_TERMINATION_UNVERIFIED')) {
			process.emitWarning(error, { code: 'CLUSTERING_TERMINATION_UNVERIFIED' });
		}

		this.emitSafe('clusterError', cluster, error);
		this.emitSafe('error', error);
		this._debug(`Cluster ${cluster.id} reported an error: ${error.message}.`);
	}

	/* ----------------------------------- Internal ----------------------------------- */

	public requestFromCluster<T>(cluster: RefCluster<InternalClient>, message: BaseMessage<DataType>, timeout = this.options.advanced.ipcTimeout): Promise<T> {
		const nonce = message._nonce ?? ShardingUtils.generateNonce();
		message._nonce = nonce;
		const pending = this.promise.create<T>(this.promiseKey(cluster, nonce), timeout);
		return cluster
			._sendInstance(message)
			.catch((error: unknown) => {
				this.promise.reject(this.promiseKey(cluster, nonce), error instanceof Error ? error : new Error(String(error)));
			})
			.then(() => pending);
	}

	private promiseKey(cluster: RefCluster<InternalClient>, nonce: string): string {
		return `${cluster.id}:${this.clusterGeneration(cluster)}:${nonce}`;
	}

	private clusterGeneration(cluster: RefCluster<InternalClient>): number {
		return cluster.generationNumber;
	}

	private targetClusters(options: EvalOptions): InternalCluster[] {
		let targets = [...this.clusters.values()];

		if (options.guildId !== undefined) {
			const clusterId = ShardingUtils.clusterIdForGuildId(options.guildId, this.options.totalShards, this.options.totalClusters);
			const cluster = this.clusters.get(clusterId);
			return cluster ? [cluster] : [];
		}

		if (options.cluster !== undefined) {
			const ids = Array.isArray(options.cluster) ? options.cluster : [options.cluster];
			if (!ids.every((id) => Number.isInteger(id) && id >= 0)) throw new RangeError('CLUSTER_ID_OUT_OF_RANGE | Cluster IDs must be non-negative integers.');
			targets = targets.filter((cluster) => ids.includes(cluster.id));
		}

		if (options.shard !== undefined) {
			const shards = Array.isArray(options.shard) ? options.shard : [options.shard];
			if (!shards.every((shard) => Number.isInteger(shard) && shard >= 0 && shard < this.options.totalShards)) throw new RangeError('SHARD_ID_OUT_OF_RANGE | Shard IDs must belong to the configured topology.');
			targets = targets.filter((cluster) => cluster.shardList.some((shard) => shards.includes(shard)));
		}

		return targets;
	}

	public checkReady(): void {
		const allReady = this.clusters.size > 0 && [...this.clusters.values()].every((cluster) => cluster.ready);
		if (allReady && !this.ready) {
			this._debug('All clusters are ready, so the manager is ready.');
			this.ready = true;
			this.emitSafe('ready', this);

			for (const cluster of this.clusters.values()) {
				void cluster._sendInstance({ _type: MessageTypes.ManagerReady }).catch((error: unknown) => {
					this._debug(`The manager could not notify cluster ${cluster.id} that all clusters are ready: ${error instanceof Error ? error.message : String(error)}.`);
				});
			}
		}

		if (!allReady && this.ready) this._debug('The manager became unready because at least one cluster is not ready.');
		if (!allReady) this.ready = false;
	}

	public _debug(message: string): void {
		this.emitSafe('debug', message);
	}

	private emitSafe(event: string, ...args: unknown[]): void {
		for (const listener of this.rawListeners(event)) {
			try {
				Reflect.apply(listener, this, args);
			} catch (error: unknown) {
				const normalized = error instanceof Error ? error : new Error(String(error));

				if (event !== 'error' && this.rawListeners('error').length) this.emitSafe('error', normalized);
				else process.emitWarning(normalized, { code: 'CLUSTER_MANAGER_LISTENER_FAILED' });
			}
		}
	}
}

function isLifecycleRecord(value: unknown): value is ClusterLifecycleRecord {
	return value !== null && typeof value === 'object' && 'state' in value && typeof value.state === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function packageTypeFromData(value: unknown): 'discord.js' | '@discordjs/core' | null | undefined {
	if (!isRecord(value) || !('packageType' in value)) return undefined;
	if (value.packageType === 'discord.js' || value.packageType === '@discordjs/core' || value.packageType === null) return value.packageType;
	return undefined;
}

function heartbeatFromData(value: unknown): { nonce: string; receivedAt: number; ready: boolean } | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.nonce !== 'string' || typeof value.receivedAt !== 'number' || !Number.isFinite(value.receivedAt) || typeof value.ready !== 'boolean') return undefined;
	return { nonce: value.nonce, receivedAt: value.receivedAt, ready: value.ready };
}

function errorMessageFromData(value: unknown): string {
	if (isRecord(value) && typeof value.message === 'string') return value.message;
	return 'IPC request failed.';
}

function clientBroadcastFromData(value: unknown): { message: Serializable; ignore: number[] } | undefined {
	if (!isRecord(value) || !('message' in value) || !ShardingUtils.isSerializable(value.message)) return undefined;
	if (value.ignore === undefined) return { message: value.message, ignore: [] };
	if (typeof value.ignore === 'number' && Number.isInteger(value.ignore) && value.ignore >= 0) return { message: value.message, ignore: [value.ignore] };
	if (Array.isArray(value.ignore) && value.ignore.every((id) => Number.isInteger(id) && id >= 0)) return { message: value.message, ignore: value.ignore };
	return undefined;
}

interface EvalRequestData {
	script: string;
	options?: EvalOptions;
}

function evalRequestFromData(value: unknown): EvalRequestData | undefined {
	if (!isRecord(value) || typeof value.script !== 'string') return undefined;
	return { script: value.script, options: evalOptionsFromValue(value.options) };
}

function evalOptionsFromValue(value: unknown): EvalOptions | undefined {
	if (!isRecord(value)) return undefined;
	const options: EvalOptions = {};
	if (numberOrArray(value.cluster)) options.cluster = value.cluster;
	if (numberOrArray(value.shard)) options.shard = value.shard;
	if (typeof value.guildId === 'string') options.guildId = value.guildId;
	if (isRecord(value.context)) options.context = value.context;
	if (numberValue(value.timeout) !== undefined) options.timeout = numberValue(value.timeout);
	if (typeof value.useAllSettled === 'boolean') options.useAllSettled = value.useAllSettled;
	return options;
}

function respawnDataFromMessage(value: unknown): {
	clusterDelay?: number;
	respawnDelay?: number;
	timeout?: number;
	except?: number[];
} | undefined {
	if (!isRecord(value)) return undefined;
	return {
		clusterDelay: numberValue(value.clusterDelay),
		respawnDelay: numberValue(value.respawnDelay),
		timeout: numberValue(value.timeout),
		except: numberArray(value.except),
	};
}

function respawnSpecificDataFromMessage(value: unknown): {
	clusterIds: number[];
	clusterDelay?: number;
	respawnDelay?: number;
	timeout?: number;
} | undefined {
	if (!isRecord(value) || !Array.isArray(value.clusterIds)) return undefined;
	const clusterIds = numberArray(value.clusterIds);
	if (!clusterIds) return undefined;
	return {
		clusterIds,
		clusterDelay: numberValue(value.clusterDelay),
		respawnDelay: numberValue(value.respawnDelay),
		timeout: numberValue(value.timeout),
	};
}

function numberValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return undefined;
	return value;
}

function numberOrArray(value: unknown): value is number | number[] {
	return typeof value === 'number' && Number.isFinite(value) || numberArray(value) !== undefined;
}

export declare interface ClusterManager<
	InternalClient extends ClientRefType = ClientRefType,
	InternalCluster extends RefCluster<InternalClient> = RefCluster<InternalClient>,
> {
	emit<K extends keyof ClusterManagerEvents<this, InternalCluster>>(event: K, ...args: ClusterManagerEvents<this, InternalCluster>[K]): boolean;
	on<K extends keyof ClusterManagerEvents<this, InternalCluster>>(event: K, listener: (...args: ClusterManagerEvents<this, InternalCluster>[K]) => void): this;
	once<K extends keyof ClusterManagerEvents<this, InternalCluster>>(event: K, listener: (...args: ClusterManagerEvents<this, InternalCluster>[K]) => void): this;
	off<K extends keyof ClusterManagerEvents<this, InternalCluster>>(event: K, listener: (...args: ClusterManagerEvents<this, InternalCluster>[K]) => void): this;
}
