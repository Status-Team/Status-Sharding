import { ClusterEvents, ClusterKillOptions, EvalOptions, MessageTypes, Serialized, Awaitable } from '../types';
import { ProcessMessage, BaseMessage, DataType } from '../other/message';
import { ClusterHandler } from '../handlers/message';
import ShardingUtils from '../other/shardingUtils';
import { ClusterManager } from './clusterManager';
import { ShardingClient } from './clusterClient';
import { Serializable } from 'child_process';
import { Worker } from '../classes/worker';
import { Child } from '../classes/child';
import { Guild } from 'discord.js';
import EventEmitter from 'events';
import path from 'path';

// A self-contained cluster created by the ClusterManager.
// Each one has a Child that contains an instance of the bot and its Client.
// When its child process/worker exits for any reason, the cluster will spawn a new one to replace it as necessary.
export class Cluster extends EventEmitter {
	private ThreadOrProcess: typeof Worker | typeof Child;

	public ready: boolean;
	private thread: null | Worker | Child;
	private messageHandler?: ClusterHandler;
	public lastHeartbeatReceived: number;

	private env: NodeJS.ProcessEnv & {
		SHARD_LIST: number[];
		TOTAL_SHARDS: number;
		CLUSTER_MANAGER: boolean;
		CLUSTER: number;
		CLUSTER_COUNT: number;
		DISCORD_TOKEN: string;
		AUTO_LOGIN: boolean;
	};

	constructor(public manager: ClusterManager, public id: number, public shardList: number[]) {
		super();

		this.lastHeartbeatReceived = Date.now();
		this.ThreadOrProcess = manager.options.mode === 'worker' ? Worker : Child;

		this.ready = false; this.thread = null;

		this.env = Object.assign({}, process.env, {
			SHARD_LIST: this.shardList,
			TOTAL_SHARDS: this.totalShards,
			CLUSTER_MANAGER: true,
			CLUSTER: this.id,
			CLUSTER_COUNT: this.manager.options.totalClusters,
			DISCORD_TOKEN: this.manager.options.token,
			AUTO_LOGIN: this.manager.options.autoLogin ?? false,
		});
	}

	get totalShards(): number {
		return this.manager.options.totalShards;
	}

	get totalClusters(): number {
		return this.manager.options.totalClusters;
	}

	public async spawn(spawnTimeout = 30000) {
		if (this.thread) throw new Error('CLUSTER ALREADY SPAWNED | Cluster ' + this.id + ' has already been spawned.');

		this.thread = new this.ThreadOrProcess(path.resolve(this.manager.file), {
			...this.manager.options.clusterOptions,
			execArgv: this.manager.options.execArgv,
			env: this.env,
			args: [...(this.manager.options.shardArgs || []), '--clusterId ' + this.id, `--shards [${this.shardList.join(', ').trim()}]`],
			clusterData: { ...this.env, ...this.manager.options.clusterData },
		});

		this.messageHandler = new ClusterHandler(this, this.thread);

		const thread = this.thread.spawn();
		thread.on('message', this._handleMessage.bind(this));
		thread.on('error', this._handleError.bind(this));
		thread.on('exit', this._handleExit.bind(this));

		this.emit('spawn', this.thread.process);

		if (spawnTimeout === -1 || spawnTimeout === Infinity) return this.thread.process;

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

			const spawnTimeoutTimer = setTimeout(onTimeout, spawnTimeout);
			this.once('ready', onReady); this.once('death', onDeath);
		});

		return this.thread.process;
	}

	public async kill(options?: ClusterKillOptions) {
		this.thread?.kill();
		if (this.thread) this.thread = null;

		this.ready = false;

		this.manager.heartbeat.removeCluster(this.id);
		this.manager._debug('[KILL] Cluster killed with reason: ' + (options?.reason || 'Unknown reason.'));
	}

	public async respawn(delay = this.manager.options.spawnOptions.delay || 500, timeout = this.manager.options.spawnOptions.timeout || 30000) {
		if (this.thread) await this.kill({ force: true });
		if (delay > 0) await ShardingUtils.delayFor(delay);

		// const heartbeat = this.manager.heartbeat;
		// if (heartbeat) heartbeat.clusters.get(this.id)?.stop();

		return this.spawn(timeout);
	}

	public async send(message: Serializable) {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker.'));
		this.manager._debug(`[IPC] [Cluster ${this.id}] Sending message to child.`);

		return this.thread?.send({
			_type: MessageTypes.CustomMessage,
			data: message,
		} as BaseMessage<'normal'>);
	}

	public async request<O>(message: Serializable, options: { timeout?: number; } = {}): Promise<Serialized<O>> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker.'));
		const nonce = ShardingUtils.generateNonce();

		this.thread?.send({
			_type: MessageTypes.CustomRequest,
			_nonce: nonce,
			data: message,
		} as BaseMessage<'reply'>);

		return this.manager.promise.create(nonce, options.timeout);
	}

	public async eval<T, P>(script: string | ((cluster: Cluster, context: Serialized<P>) => Awaitable<T>), options?: Exclude<EvalOptions<P>, 'cluster'>): Promise<T extends never ? unknown : Serialized<T>> {
		return eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
	}

	public async evalOnClient<T, P>(script: string | ((client: ShardingClient, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<(T extends never ? unknown : Serialized<T>)> {
		if (!this.thread) return Promise.reject(new Error('CLUSTERING_NO_CHILD_EXISTS | Cluster ' + this.id + ' does not have a child process/worker.'));
		const nonce = ShardingUtils.generateNonce();

		this.thread?.send({
			_type: MessageTypes.ClientEvalRequest,
			_nonce: nonce,
			data: {
				script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`,
				options: options,
			},
		} as BaseMessage<'eval'>);

		return this.manager.promise.create(nonce, options?.timeout);
	}

	public async evalOnGuild<T, P>(guildId: string, script: string | ((client: ShardingClient, context: Serialized<P>, guild: Guild) => Awaitable<T>), options?: { context?: P; timeout?: number; }): Promise<T extends never ? unknown : Serialized<T>> {
		return this.manager.evalOnGuild(guildId, typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`, options);
	}

	public triggerMaintenance(reason?: string) {
		return this.send({
			_type: reason ? MessageTypes.ClientMaintenanceEnable : MessageTypes.ClientMaintenanceDisable,
			data: reason || 'Unknown reason.',
		} as BaseMessage<'maintenance'>);
	}

	public _sendInstance(message: BaseMessage<DataType>) {
		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
		return this.thread?.send(message);
	}

	private _handleMessage(message: BaseMessage<'normal'>) {
		if (!message) return;

		this.manager._debug(`[IPC] [Cluster ${this.id}] Received message from child.`);
		this.messageHandler?.handleMessage(message);

		if ([MessageTypes.CustomMessage, MessageTypes.CustomRequest].includes(message._type)) {
			const ipcMessage = new ProcessMessage(this, message);
			if (message._type === MessageTypes.CustomRequest) this.manager.emit('clientRequest', ipcMessage);

			this.emit('message', ipcMessage);
		}
	}

	private _handleExit(exitCode: number) {
		this.manager.heartbeat.removeCluster(this.id);
		this.emit('death', this, this.thread?.process);

		this.manager._debug('[Death] [Cluster ' + this.id + '] Cluster died with exit code ' + exitCode + '.');

		this.ready = false;
		this.thread = null;
	}

	private _handleError(error: Error) {
		this.manager.emit('error', error);
	}
}

// Credits for EventEmitter typings: https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/RequestManager.ts#L159
export interface Cluster {
	emit: (<K extends keyof ClusterEvents>(event: K, ...args: ClusterEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, ...args: unknown[]) => boolean);
	off: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	on: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	once: (<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterEvents>, listener: (...args: unknown[]) => void) => this);
	removeAllListeners: (<K extends keyof ClusterEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterEvents>) => this);
}
