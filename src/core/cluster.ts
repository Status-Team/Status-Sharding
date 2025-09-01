import { ClusterEvents, ClusterKillOptions, EvalOptions, MessageTypes, Serialized, Awaitable, ValidIfSerializable, SerializableInput, Serializable } from '../types';
import { ProcessMessage, BaseMessage, DataType } from '../other/message';
import { Worker as WorkerThread } from 'worker_threads';
import { ShardingUtils } from '../other/shardingUtils';
import { RefClusterManager } from './clusterManager';
import { ClusterHandler } from '../handlers/message';
import { BrokerMessage } from '../handlers/broker';
import { RefShardingClient } from './client';
import { ChildProcess } from 'child_process';
import { Worker } from '../classes/worker';
import { Child } from '../classes/child';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';

/** A self-contained cluster created by the ClusterManager. */
export class Cluster<
	InternalManager extends RefClusterManager = RefClusterManager,
	InternalClient extends RefShardingClient = RefShardingClient,
> extends EventEmitter {
	/** Represents whether the cluster is ready. */
	public ready: boolean;
	/** Exited. */
	public exited: boolean = false;
	/** Represents the child process/worker of the cluster. */
	public thread: null | Worker | Child;
	/** Represents the last time the cluster received a heartbeat. */
	public lastHeartbeatReceived?: number;
	/** Message processor that handles messages from the child process/worker/manager. */
	private messageHandler?: ClusterHandler;
	/** Represents the environment data of the cluster. */
	private envData: NodeJS.ProcessEnv & {
		CLUSTER: number;
		SHARD_LIST: number[];
		TOTAL_SHARDS: number;
		CLUSTER_COUNT: number;
		CLUSTER_QUEUE_MODE: 'auto' | 'manual';
		CLUSTER_MANAGER_MODE: 'process' | 'worker';
	};

	/** Track active spawn/kill operations to prevent race conditions */
	private _operationInProgress = false;

	/** Creates an instance of Cluster. */
	constructor (public manager: InternalManager, public id: number, public shardList: number[]) {
		super();

		this.ready = false;
		this.thread = null;

		this.envData = Object.assign({}, process.env, {
			CLUSTER: this.id,
			SHARD_LIST: this.shardList,
			TOTAL_SHARDS: this.totalShards,
			CLUSTER_COUNT: this.manager.options.totalClusters,
			CLUSTER_QUEUE_MODE: this.manager.options.queueOptions?.mode ?? 'auto',
			CLUSTER_MANAGER_MODE: this.manager.options.mode,
		});
	}

	/** Count of shards assigned to this cluster. */
	get totalShards(): number {
		return this.manager.options.totalShards;
	}

	/** Count of clusters managed by the manager. */
	get totalClusters(): number {
		return this.manager.options.totalClusters;
	}

	/** Spawn function that spawns the cluster's child process/worker with proper event management. */
	public async spawn(spawnTimeout: number = -1): Promise<ChildProcess | WorkerThread> {
		if (this._operationInProgress) throw new Error('CLUSTER_OPERATION_IN_PROGRESS | Another spawn/kill operation is already in progress for cluster ' + this.id);
		else if (this.thread) throw new Error('CLUSTER_ALREADY_SPAWNED | Cluster ' + this.id + ' has already been spawned.');
		else if (!this.manager.file) throw new Error('NO_FILE_PROVIDED | Cluster ' + this.id + ' does not have a file provided.');

		this._operationInProgress = true;

		try {
			const options = {
				...this.manager.options.clusterOptions,
				execArgv: this.manager.options.execArgv,
				env: this.envData,
				args: [...(this.manager.options.shardArgs || []), '--clusterId ' + this.id, `--shards [${this.shardList.join(', ').trim()}]`],
				clusterData: { ...this.envData, ...this.manager.options.clusterData },
			};

			this.thread = this.manager.options.mode === 'process'
				? new Child(path.resolve(this.manager.file), options)
				: new Worker(path.resolve(this.manager.file), options);

			this.messageHandler = new ClusterHandler(this, this.thread);
			const thread = this.thread.spawn();

			this._setupEventListeners(thread);
			this.emit('spawn', this, this.thread.process);

			const shouldAbort = spawnTimeout > 0 && spawnTimeout !== Infinity;

			await new Promise<void>((resolve, reject) => {
				const cleanup = (isDeath: boolean = false) => {
					if (spawnTimeoutTimer !== -1) clearTimeout(spawnTimeoutTimer);

					if (isDeath) {
						this.off('ready', onReady);
						this.off('death', onDeath);
					}
				};

				const onReady = () => {
					this.manager.emit('clusterReady', this);
					cleanup();
					resolve();
				};

				const onDeath = () => {
					cleanup(true);
					reject(new Error('CLUSTERING_READY_DIED | Cluster ' + this.id + ' died.'));
				};

				const onTimeout = () => {
					cleanup();
					reject(new Error('CLUSTERING_READY_TIMEOUT | Cluster ' + this.id + ' took too long to get ready.'));
				};

				const spawnTimeoutTimer = shouldAbort ? setTimeout(onTimeout, spawnTimeout) : -1;

				this.once('ready', onReady);
				this.once('death', onDeath);

				if (!shouldAbort) resolve();
			});

			return this.thread.process as ChildProcess | WorkerThread;
		} finally {
			this._operationInProgress = false;
		}
	}

	private _setupEventListeners(thread: ChildProcess | WorkerThread): void {
		if (!thread) return;

		thread.addListener('message', this._handleMessage.bind(this));
		thread.addListener('error', this._handleError.bind(this));
		thread.addListener('exit', this._handleExit.bind(this));
	}

	public async kill(options?: ClusterKillOptions): Promise<void> {
		if (this._operationInProgress) throw new Error('CLUSTER_OPERATION_IN_PROGRESS | Another spawn/kill operation is already in progress for cluster ' + this.id);
		else if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#1).'));

		this._operationInProgress = true;

		try {
			const check = await this.thread.kill();
			if (!check) throw new Error('CLUSTERING_KILL_FAILED | Cluster ' + this.id + ' failed to kill the child process/worker.');

			this.thread = null;
			this.ready = false;
			this.exited = true;

			this.manager.heartbeat?.removeCluster(this.id);
			this.manager._debug('[KILL] Cluster killed with reason: ' + (options?.reason || 'Unknown reason.'));
		} finally {
			this._operationInProgress = false;
		}
	}

	/** Respawn function that respawns the cluster's child process/worker. */
	public async respawn(delay: number = this.manager.options.spawnOptions.delay || 5500, timeout: number = this.manager.options.spawnOptions.timeout || -1): Promise<ChildProcess | WorkerThread> {
		if (this._operationInProgress) throw new Error('CLUSTER_OPERATION_IN_PROGRESS | Another spawn/kill operation is already in progress for cluster ' + this.id);

		this.ready = false;
		this.exited = false;

		if (this.thread) await this.kill();
		if (delay > 0) await ShardingUtils.delayFor(delay);

		return this.spawn(timeout);
	}

	/** Send function that sends a message to the cluster's child process/worker. */
	public async send<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#2).'));
		this.manager._debug(`[IPC] [Cluster ${this.id}] Sending message to child.`);

		return this.thread.send({
			_type: MessageTypes.CustomMessage,
			data: message,
		} as BaseMessage<'normal'>);
	}

	/** Request function that sends a message to the cluster's child process/worker and waits for a response. */
	public async request<T extends Serializable, O>(message: SerializableInput<T>, options: { timeout?: number; } = {}): Promise<Serialized<O>> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#3).'));
		const nonce = ShardingUtils.generateNonce();

		this.thread.send<BaseMessage<'reply'>>({
			_type: MessageTypes.CustomRequest,
			_nonce: nonce,
			data: message,
		});

		return this.manager.promise.create(nonce, options.timeout);
	}

	/** Broadcast function that sends a message to all clusters. */
	public async broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf: boolean = false): Promise<void> {
		return await this.manager.broadcast(message, sendSelf ? undefined : [this.id]);
	}

	/** Eval function that evaluates a script on the current cluster. */
	public async eval<T, P extends object, C = Cluster<InternalManager, InternalClient>>(script: string | ((cluster: C, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>> {
		return eval(ShardingUtils.parseInput(script, options?.context));
	}

	/** EvalOnClient function that evaluates a script on a specific cluster. */
	public async evalOnClient<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#4).'));

		const nonce = ShardingUtils.generateNonce();

		this.thread.send<BaseMessage<'eval'>>({
			_type: MessageTypes.ClientEvalRequest,
			_nonce: nonce,
			data: {
				script: ShardingUtils.parseInput(script, options?.context),
				options: options,
			},
		});

		return this.manager.promise.create(nonce, options?.timeout);
	}

	/** EvalOnCluster function that evaluates a script on a specific cluster. */
	public async evalOnGuild<T, P extends object, C = InternalClient>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild: Guild | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#5).'));
		return this.manager.evalOnGuild(guildId, script, options);
	}

	/** Function that allows you to construct your own BaseMessage and send it to the cluster. */
	public _sendInstance<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): Promise<void> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#6).'));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
		return this.thread.send(message);
	}

	/** Message handler function that handles messages from the cluster's child process/worker/manager. */
	private _handleMessage(message: BaseMessage<'normal'> | BrokerMessage): void {
		if (!message || '_data' in message) return this.manager.broker.handleMessage(message);
		else if (!this.messageHandler) throw new Error('CLUSTERING_NO_MESSAGE_HANDLER | Cluster ' + this.id + ' does not have a message handler.');

		if (this.manager.options.advanced?.logMessagesInDebug) {
			this.manager._debug(`[IPC] [Cluster ${this.id}] Received message from child.`);
		}

		this.messageHandler.handleMessage(message);

		if ([MessageTypes.CustomMessage, MessageTypes.CustomRequest].includes(message._type)) {
			const ipcMessage = new ProcessMessage(this, message);
			if (message._type === MessageTypes.CustomRequest) {
				this.manager.emit('clientRequest', ipcMessage);
			}

			this.emit('message', ipcMessage);
			this.manager.emit('message', ipcMessage);
		}
	}

	/** Exit handler function that handles the cluster's child process/worker exiting. */
	private _handleExit(exitCode: number): void {
		this.emit('death', this, this.thread?.process || null);

		this.manager._debug('[Death] [Cluster ' + this.id + '] Cluster died with exit code ' + exitCode + '.');

		this.ready = false;
		this.thread = null;
		this.exited = true;
	}

	/** Error handler function that handles errors from the cluster's child process/worker/manager. */
	private _handleError(error: Error): void {
		this.manager.emit('error', error);
	}
}

export type RefCluster = Cluster;

// Credits for EventEmitter typings: https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/RequestManager.ts#L159
/** A self-contained cluster created by the ClusterManager. */
export declare interface Cluster {
	/** Emit an event. */
	emit: (<K extends keyof ClusterEvents>(event: K, ...args: ClusterEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, ...args: unknown[]) => boolean);
	/** Remove an event listener. */
	off: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	/** Listen for an event. */
	on: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	/** Listen for an event once. */
	once: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	/** Remove all listeners for an event. */
	removeAllListeners: (<K extends keyof ClusterEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterEvents>) => this);
}
