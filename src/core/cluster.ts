import { ClusterEvents, ClusterKillOptions, EvalOptions, MessageTypes, Serialized, Awaitable, ValidIfSerializable, SerializableInput, Serializable } from '../types';
import { ProcessMessage, BaseMessage, DataType } from '../other/message';
import { Worker as WorkerThread } from 'worker_threads';
import { ShardingUtils } from '../other/shardingUtils';
import { ClusterHandler } from '../handlers/message';
import { RefClusterManager } from './clusterManager';
import { RefShardingClient } from './clusterClient';
import { BrokerMessage } from '../handlers/broker';
import { ChildProcess } from 'child_process';
import { Worker } from '../classes/worker';
import { Child } from '../classes/child';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';

/**
 * A self-contained cluster created by the ClusterManager.
 * Each one has a Child that contains an instance of the bot and its Client.
 * When its child process/worker exits for any reason, the cluster will spawn a new one to replace it as necessary.
 * @export
 * @class Cluster
 * @typedef {Cluster<ClusterManager>} - The Cluster type.
 * @extends {EventEmitter}
 */
export class Cluster<
	InternalManager extends RefClusterManager = RefClusterManager,
	InternalClient extends RefShardingClient = RefShardingClient,
> extends EventEmitter {
	/**
	 * Represents whether the cluster is ready.
	 */
	public ready: boolean;
	/**
	 * Represents the child process/worker of the cluster.
	 */
	public thread: null | Worker | Child;
	/**
	 * Represents the last time the cluster received a heartbeat.
	 */
	public lastHeartbeatReceived?: number;

	/**
	 * Message processor that handles messages from the child process/worker/manager.
	 * @private
	 * @type {?ClusterHandler}
	 */
	private messageHandler?: ClusterHandler;

	/**
	 * Represents the environment data of the cluster.
	 * @private
	 * @type {NodeJS.ProcessEnv & {
	 * 		CLUSTER: number;
	 * 		SHARD_LIST: number[];
	 * 		TOTAL_SHARDS: number;
	 * 		CLUSTER_COUNT: number;
	 * 		CLUSTER_QUEUE_MODE: 'auto' | 'manual';
	 * 		CLUSTER_MANAGER_MODE: 'process' | 'worker';
	 * 	}}
	 */
	private envData: NodeJS.ProcessEnv & {
		CLUSTER: number;
		SHARD_LIST: number[];
		TOTAL_SHARDS: number;
		CLUSTER_COUNT: number;
		CLUSTER_QUEUE_MODE: 'auto' | 'manual';
		CLUSTER_MANAGER_MODE: 'process' | 'worker';
	};

	/**
	 * Creates an instance of Cluster.
	 * @constructor
	 * @param {InternalManager} manager - The ClusterManager instance that manages this cluster.
	 * @param {number} id - The ID of the cluster.
	 * @param {number[]} shardList - The list of shards assigned to this cluster.
	 */
	constructor(public manager: InternalManager, public id: number, public shardList: number[]) {
		super();

		this.ready = false; this.thread = null;

		this.envData = Object.assign({}, process.env, {
			CLUSTER: this.id,
			SHARD_LIST: this.shardList,
			TOTAL_SHARDS: this.totalShards,
			CLUSTER_COUNT: this.manager.options.totalClusters,
			CLUSTER_QUEUE_MODE: this.manager.options.queueOptions?.mode ?? 'auto',
			CLUSTER_MANAGER_MODE: this.manager.options.mode,
		});
	}

	/**
	 * Count of shards assigned to this cluster.
	 * @readonly
	 * @type {number}
	 */
	get totalShards(): number {
		return this.manager.options.totalShards;
	}

	/**
	 * Count of clusters managed by the manager.
	 * @readonly
	 * @type {number}
	 */
	get totalClusters(): number {
		return this.manager.options.totalClusters;
	}

	/**
	 * Spawn function that spawns the cluster's child process/worker.
	 * @async
	 * @param {number} [spawnTimeout=30000] - The amount of time to wait for the cluster to become ready before killing it.
	 * @returns {Promise<ChildProcess | WorkerThread>} The child process/worker of the cluster.
	 * @throws {Error} - If the cluster has already been spawned.
	 * @throws {Error} - If the cluster does not have a file provided.
	 */
	public async spawn(spawnTimeout: number = 30000): Promise<ChildProcess | WorkerThread> {
		if (this.thread) throw new Error('CLUSTER_ALREADY_SPAWNED | Cluster ' + this.id + ' has already been spawned.');
		else if (!this.manager.file) throw new Error('NO_FILE_PROVIDED | Cluster ' + this.id + ' does not have a file provided.');

		const options = {
			...this.manager.options.clusterOptions,
			execArgv: this.manager.options.execArgv,
			env: this.envData,
			args: [...(this.manager.options.shardArgs || []), '--clusterId ' + this.id, `--shards [${this.shardList.join(', ').trim()}]`],
			clusterData: { ...this.envData, ...this.manager.options.clusterData },
		};

		this.thread = this.manager.options.mode === 'process' ? new Child(path.resolve(this.manager.file), options) : new Worker(path.resolve(this.manager.file), options);
		this.messageHandler = new ClusterHandler(this, this.thread);

		const thread = this.thread.spawn();
		thread.on('message', this._handleMessage.bind(this));
		thread.on('error', this._handleError.bind(this));
		thread.on('exit', this._handleExit.bind(this));

		this.emit('spawn', this.thread.process);

		const shouldAbort = spawnTimeout > 0 && spawnTimeout !== Infinity;

		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(spawnTimeoutTimer);

				this.off('ready', onReady);
				this.off('death', onDeath);
			};

			const onReady = () => {
				this.manager.emit('clusterReady', this);
				cleanup(); resolve();
			};

			const onDeath = () => {
				cleanup(); reject(new Error('CLUSTERING_READY_DIED | Cluster ' + this.id + ' died.'));
			};

			const onTimeout = () => {
				cleanup(); reject(new Error('CLUSTERING_READY_TIMEOUT | Cluster ' + this.id + ' took too long to get ready.'));
			};

			const spawnTimeoutTimer = shouldAbort ? setTimeout(onTimeout, spawnTimeout) : -1;
			this.once('ready', onReady); this.once('death', onDeath);
			if (!shouldAbort) resolve();
		});

		return this.thread.process as ChildProcess | WorkerThread;
	}

	/**
	 * Kill function that kills the cluster's child process/worker.
	 * @async
	 * @param {?ClusterKillOptions} [options] - The options for killing the cluster.
	 * @returns {Promise<void>} The promise that resolves once the cluster has been killed.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 */
	public async kill(options?: ClusterKillOptions): Promise<void> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#1).'));

		const check = await this.thread.kill();
		if (!check) return Promise.reject(new Error('CLUSTERING_KILL_FAILED | Cluster ' + this.id + ' failed to kill the child process/worker.'));

		this.thread = null;
		this.ready = false;

		this.manager.heartbeat?.removeCluster(this.id);
		this.manager._debug('[KILL] Cluster killed with reason: ' + (options?.reason || 'Unknown reason.'));
	}

	/**
	 * Respawn function that respawns the cluster's child process/worker.
	 * @async
	 * @param {number} [delay=this.manager.options.spawnOptions.delay || 800] - The amount of time to wait before respawning the cluster.
	 * @param {number} [timeout=this.manager.options.spawnOptions.timeout || 30000] - The amount of time to wait for the cluster to become ready before killing it.
	 * @returns {Promise<ChildProcess | WorkerThread>} The child process/worker of the cluster.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 */
	public async respawn(delay: number = this.manager.options.spawnOptions.delay || 800, timeout: number = this.manager.options.spawnOptions.timeout || 30000): Promise<ChildProcess | WorkerThread> {
		if (this.thread) await this.kill();
		if (delay > 0) await ShardingUtils.delayFor(delay);

		return this.spawn(timeout);
	}

	/**
	 * Send function that sends a message to the cluster's child process/worker.
	 * @async
	 * @template {Serializable} T - The type of the message to send.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @returns {Promise<void>} The promise that resolves once the message has been sent.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 * @example
	 * cluster.send({ id: '797012765352001557', username: 'Digital', discriminator: '3999' });
	 */
	public async send<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#2).'));
		this.manager._debug(`[IPC] [Cluster ${this.id}] Sending message to child.`);

		return this.thread.send({
			_type: MessageTypes.CustomMessage,
			data: message,
		} as BaseMessage<'normal'>);
	}

	/**
	 * Request function that sends a message to the cluster's child process/worker and waits for a response.
	 * @async
	 * @template {Serializable} T - The type of the message to send.
	 * @template {unknown} O - The type of the response to the message.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @param {{ timeout?: number; }} [options={}] - The options for the request.
	 * @returns {Promise<Serialized<O>>} The promise that resolves with the response to the message.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 * @example
	 * cluster.request({ customMessage: 'Hello world!' });
	 */
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

	/**
	 * Broadcast function that sends a message to all clusters.
	 * @async
	 * @template {Serializable} T - The type of the message to send.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @param {boolean} [sendSelf=false] - Whether to send the message to the current cluster.
	 * @returns {Promise<void>} The promise that resolves once the message has been sent.
	 * @example
	 * cluster.broadcast({ customMessage: 'Hello world!' });
	 */
	public async broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf: boolean = false): Promise<void> {
		return await this.manager.broadcast(message, sendSelf ? undefined : [this.id]);
	}

	/**
	 * Eval function that evaluates a script on the current cluster.
	 * @async
	 * @template {unknown} T - The type of the result of the script.
	 * @template {object} P - The type of the context of the script.
	 * @param {(string | ((cluster: Cluster<InternalManager>, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?Exclude<EvalOptions<P>, 'cluster'>} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>>} The promise that resolves with the result of the script.
	 * @example
	 * cluster.eval('this.manager.clusters.size'); // 1
	*/
	public async eval<T, P extends object, C = Cluster<InternalManager, InternalClient>>(script: string | ((cluster: C, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<ValidIfSerializable<T>> {
		return eval(typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`);
	}

	/**
	 * EvalOnClient function that evaluates a script on a specific cluster.
	 * @async
	 * @template {unknown} T - The type of the result of the script.
	 * @template {object} P - The type of the context of the script.
	 * @template {unknown} [C=ShardingClient] - The type of the client to use.
	 * @param {(string | ((client: C, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?EvalOptions<P>} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>>} The promise that resolves with the result of the script.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 * @example
	 * cluster.evalOnClient((client) => client.cluster.id); // 0
	 * cluster.evalOnClient((client, context) => client.cluster.id + context, { context: 1 }); // 0 + 1
	 */
	public async evalOnClient<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#4).'));
		else if (typeof script !== 'string' && typeof script !== 'function') return Promise.reject(new Error('CLUSTERING_INVALID_EVAL_TYPE | Cluster ' + this.id + ' eval script must be a string or function.'));

		const nonce = ShardingUtils.generateNonce();

		this.thread.send<BaseMessage<'eval'>>({
			_type: MessageTypes.ClientEvalRequest,
			_nonce: nonce,
			data: {
				script: typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`,
				options: options,
			},
		});

		return this.manager.promise.create(nonce, options?.timeout);
	}

	/**
	 * EvalOnCluster function that evaluates a script on a specific cluster.
	 * @async
	 * @template {unknown} T - The type of the result of the script.
	 * @template {object} P - The type of the context of the script.
	 * @template {unknown} [C=ShardingClient] - The type of the client to use.
	 * @template {boolean} [E=false] - Whether to use experimental mode.
	 * @param {string} guildId - The ID of the guild to use.
	 * @param {((client: C, context: Serialized<P>, guild: Guild) => Awaitable<T>)} script - The script to evaluate.
	 * @param {?{ context?: P; timeout?: number; experimental?: E; }} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>>} The promise that resolves with the result of the script.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 * @throws {Error} - If script is not a function.
	 * @example
	 * cluster.evalOnGuild('945340723425837066', (client, context, guild) => guild.name); // Digital's Basement
	 * cluster.evalOnGuild('945340723425837066', (client, context, guild) => guild.name + context, { context: ' is cool!' }); // Digital's Basement is cool!
	 */
	public async evalOnGuild<T, P extends object, C = InternalClient, E extends boolean = false>(guildId: string, script: (client: C, context: Serialized<P>, guild: E extends true ? Guild : Guild | undefined) => Awaitable<T>, options?: { context?: P; timeout?: number; experimental?: E; }): Promise<ValidIfSerializable<T>> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#5).'));
		else if (typeof script !== 'function') return Promise.reject(new Error('CLUSTERING_INVALID_EVAL_TYPE | Cluster ' + this.id + ' eval script must be a function.'));

		return this.manager.evalOnGuild(guildId, script, options);
	}

	/**
	 * Function that enables maintenance mode on the cluster.
	 * @param {string} [reason] - The reason for enabling maintenance mode.
	 * @returns {Promise<void>} The promise that resolves once maintenance mode has been enabled.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 * @example
	 * cluster.triggerMaintenance('Updating dependencies...');
	 * cluster.triggerMaintenance();
	 */
	public triggerMaintenance(reason?: string): Promise<void> {
		return this._sendInstance({
			_type: reason ? MessageTypes.ClientMaintenanceEnable : MessageTypes.ClientMaintenanceDisable,
			data: reason || 'Unknown reason.',
		} as BaseMessage<'maintenance'>);
	}

	/**
	 * Function that allows you to constuct you'r own BaseMessage and send it to the cluster.
	 * @template {DataType} D - The type of the message to send.
	 * @template {Serializable} A - The type of the data to send.
	 * @template {object} P - The type of the data to send.
	 * @param {BaseMessage<D, A, P>} message - The message to send.
	 * @returns {Promise<void>} The promise that resolves once the message has been sent.
	 * @throws {Error} - If the cluster does not have a child process/worker.
	 * @example
	 * cluster.sendInstance({ _type: MessageTypes.CustomMessage, _nonce: '1234567890', data: { id: '797012765352001557', username: 'Digital', discriminator: '3999' } });
	 */
	public _sendInstance<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): Promise<void> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker (#6).'));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
		return this.thread.send(message);
	}

	/**
	 * Message handler function that handles messages from the cluster's child process/worker/manager.
	 * @private
	 * @param {(BaseMessage<'normal'> | BrokerMessage)} message - The message to handle.
	 * @returns {void} The void promise.
	 */
	private _handleMessage(message: BaseMessage<'normal'> | BrokerMessage): void {
		if (!message || '_data' in message) return this.manager.broker.handleMessage(message);
		else if (!this.messageHandler) throw new Error('CLUSTERING_NO_MESSAGE_HANDLER | Cluster ' + this.id + ' does not have a message handler.');

		this.manager._debug(`[IPC] [Cluster ${this.id}] Received message from child.`);
		this.messageHandler.handleMessage(message);

		if ([MessageTypes.CustomMessage, MessageTypes.CustomRequest].includes(message._type)) {
			const ipcMessage = new ProcessMessage(this, message);
			if (message._type === MessageTypes.CustomRequest) this.manager.emit('clientRequest', ipcMessage);

			this.emit('message', ipcMessage);
			this.manager.emit('message', ipcMessage);
		}
	}

	/**
	 * Exit handler function that handles the cluster's child process/worker exiting.
	 * @private
	 * @param {number} exitCode - The exit code of the cluster's child process/worker.
	 * @returns {void} The void promise.
	 */
	private _handleExit(exitCode: number): void {
		// this.manager.heartbeat?.removeCluster(this.id);
		this.emit('death', this, this.thread?.process);

		this.manager._debug('[Death] [Cluster ' + this.id + '] Cluster died with exit code ' + exitCode + '.');

		this.ready = false;
		this.thread = null;
	}

	/**
	 * Error handler function that handles errors from the cluster's child process/worker/manager.
	 * @private
	 * @param {Error} error - The error to handle.
	 * @returns {void} The void promise.
	 */
	private _handleError(error: Error): void {
		this.manager.emit('error', error);
	}
}

export type RefCluster = Cluster;

// Credits for EventEmitter typings: https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/RequestManager.ts#L159
/**
 * A self-contained cluster created by the ClusterManager.
 * Each one has a Child that contains an instance of the bot and its Client.
 * When its child process/worker exits for any reason, the cluster will spawn a new one to replace it as necessary.
 * @export
 * @interface Cluster - The Cluster interface.
 * @typedef {Cluster<ClusterManager>} - The Cluster type.
 */
export declare interface Cluster {
	/**
	 * Emit an event.
	 * @type {(<K extends keyof ClusterEvents>(event: K, ...args: ClusterEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, ...args: unknown[]) => boolean)}
	 */
	emit: (<K extends keyof ClusterEvents>(event: K, ...args: ClusterEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, ...args: unknown[]) => boolean);
	/**
	 * Remove an event listener.
	 * @type {(<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	off: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	/**
	 * Listen for an event.
	 * @type {(<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	on: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	/**
	 * Listen for an event once.
	 * @type {(<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	once: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	/**
	 * Remove all listeners for an event.
	 * @type {(<K extends keyof ClusterEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterEvents>) => this)}
	 */
	removeAllListeners: (<K extends keyof ClusterEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterEvents>) => this);
}
