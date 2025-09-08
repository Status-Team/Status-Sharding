// core/cluster.ts
import { ClusterEvents, ClusterKillOptions, EvalOptions, MessageTypes, Serialized, Awaitable, ValidIfSerializable, SerializableInput, Serializable } from '../types';
import { ProcessMessage, BaseMessage, DataType } from '../other/message';
import { Worker as WorkerThread } from 'worker_threads';
import { ShardingUtils } from '../other/shardingUtils';
import { RefClusterManager } from './clusterManager';
import { ClusterHandler } from '../handlers/message';
import { BrokerMessage } from '../handlers/broker';
import { isChildProcess } from '../other/utils';
import { ClientRefType } from './clusterClient';
import { ChildProcess } from 'child_process';
import { Worker } from '../classes/worker';
import { Child } from '../classes/child';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';

/** A self-contained cluster created by the ClusterManager. */
export class Cluster<
	InternalManager extends RefClusterManager = RefClusterManager,
	InternalClient extends ClientRefType = ClientRefType,
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
		if (!this.manager.file) throw new Error('NO_FILE_PROVIDED | Cluster ' + this.id + ' does not have a file provided.');
		if (this.thread?.process) return this.thread.process;

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

			const shouldWaitForReady = spawnTimeout > 0 && spawnTimeout !== Infinity;

			if (shouldWaitForReady) {
				await new Promise<void>((resolve, reject) => {
					const cleanup = (removeListeners: boolean = false) => {
						if (spawnTimeoutTimer) clearTimeout(spawnTimeoutTimer);
						if (removeListeners) {
							this.off('ready', onReady);
							this.off('death', onDeath);
						}
					};

					const onReady = () => {
						this.manager.emit('clusterReady', this);
						cleanup(true);
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

					const spawnTimeoutTimer = setTimeout(onTimeout, spawnTimeout);

					this.once('ready', onReady);
					this.once('death', onDeath);
				});
			}

			return this.thread.process as ChildProcess | WorkerThread;
		} catch (error) {
			console.error(`Failed to spawn cluster ${this.id}:`, error);
			throw error;
		}
	}

	private _setupEventListeners(thread: ChildProcess | WorkerThread): void {
		if (!thread) return;

		if (isChildProcess(thread)) {
			// Child process.
			thread.on('disconnect', this._handleDisconnect.bind(this));
			thread.on('message', this._handleMessage.bind(this));
			thread.on('error', this._handleError.bind(this));
			thread.on('exit', this._handleExit.bind(this));
		} else {
			// Worker thread.
			thread.on('messageerror', this._handleError.bind(this));
			thread.on('message', this._handleMessage.bind(this));
			thread.on('error', this._handleError.bind(this));
			thread.on('exit', this._handleExit.bind(this));

			const healthCheck = setInterval(() => {
				if (!this.thread?.process || ('threadId' in this.thread.process && !this.thread.process.threadId)) {
					clearInterval(healthCheck);
					this._handleUnexpectedExit();
				}
			}, 5000);

		}
	}

	public async kill(options?: ClusterKillOptions): Promise<void> {
		if (!this.thread) {
			console.warn(`Cluster ${this.id} has no thread to kill.`);
			return;
		}

		try {
			const killResult = await this.thread.kill();

			this.thread = null;
			this.ready = false;
			this.exited = true;

			this.manager.heartbeat?.removeCluster(this.id);
			this.manager._debug('[KILL] Cluster ' + this.id + ' killed with reason: ' + (options?.reason || 'Unknown reason.'));

			if (!killResult) console.warn(`Cluster ${this.id} kill operation completed but process may not have terminated cleanly.`);
		} catch (error) {
			console.error(`Error killing cluster ${this.id}:`, error);

			this.thread = null;
			this.ready = false;
			this.exited = true;
			this.manager.heartbeat?.removeCluster(this.id);
		}
	}

	/** Respawn function that respawns the cluster's child process/worker. */
	public async respawn(delay: number = this.manager.options.spawnOptions.delay || 5500, timeout: number = this.manager.options.spawnOptions.timeout || -1): Promise<ChildProcess | WorkerThread> {
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
		else if (this.manager.options.packageType !== 'discord.js') return Promise.reject(new Error('CLUSTERING_EVAL_GUILD_UNSUPPORTED | evalOnGuild is only supported in discord.js package type.'));

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
	private _handleExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
		this.manager._debug(`[Cluster ${this.id}] Process exited with code ${exitCode}, signal ${signal}`);
		if (!this.exited) this.emit('death', this, this.thread?.process || null);

		this.ready = false;
		this.exited = true;
		this.thread = null;

		this.manager.heartbeat?.removeCluster(this.id);

		if (!this.manager.heartbeat) {
			if (this.manager.options.respawn && exitCode !== 0 && exitCode !== null) {
				this.respawn().catch((err) => {
					this.manager._debug(`[Cluster ${this.id}] Failed to respawn: ${err.message}`);
				});
			}
		}
	}

	/** Error handler function that handles errors from the cluster's child process/worker/manager. */
	private _handleError(error: Error): void {
		this.manager.emit('error', error);
	}

	/** Handle unexpected disconnection. */
	private _handleDisconnect(): void {
		this.manager._debug(`[Cluster ${this.id}] Process disconnected unexpectedly.`);
		this._handleUnexpectedExit();
	}

	/** Handle unexpected exit/crash. */
	private _handleUnexpectedExit(): void {
		if (!this.exited && this.ready) {
			this.manager._debug(`[Cluster ${this.id}] Detected unexpected exit/crash.`);
			this.emit('death', this, this.thread?.process || null);

			this.ready = false;
			this.exited = true;
			this.thread = null;

			this.manager.heartbeat?.removeCluster(this.id);

			if (this.manager.options.respawn) {
				this.manager._debug(`[Cluster ${this.id}] Scheduling respawn after crash.`);

				this.respawn().catch((err) => {
					this.manager._debug(`[Cluster ${this.id}] Failed to respawn after crash: ${err.message}`);
				});
			}
		}
	}
}

export type RefCluster = Cluster;

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
