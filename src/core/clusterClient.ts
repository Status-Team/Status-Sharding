import { ClusterClientEvents, EvalOptions, MessageTypes, Serialized, Awaitable } from '../types';
import { ClientOptions, Client as DiscordClient, Guild } from 'discord.js';
import { BaseMessage, DataType, ProcessMessage } from '../other/message';
import { ClusterClientHandler } from '../handlers/message';
import { ShardingUtils } from '../other/shardingUtils';
import { PromiseHandler } from '../handlers/promise';
import { ClusterManager } from './clusterManager';
import { WorkerClient } from '../classes/worker';
import { ChildClient } from '../classes/child';
import { Serializable } from 'child_process';
import { getInfo } from '../other/data';
import EventEmitter from 'events';

export class ShardingClient extends DiscordClient {
	cluster: ClusterClient<this>;

	constructor(options: ClientOptions) {
		super({
			...options,
			shards: getInfo().ShardList,
			shardCount: getInfo().TotalShards,
		});

		this.cluster = new ClusterClient<this>(this);
	}
}

export class ClusterClient<InternalClient extends ShardingClient = ShardingClient> extends EventEmitter {
	public ready: boolean;
	public promise: PromiseHandler;
	public maintenance: string | undefined | boolean;
	private process: ChildClient | WorkerClient | null;
	private queue: { mode: 'auto' | string | undefined };
	private messageHandler: ClusterClientHandler<InternalClient>;

	constructor(public client: InternalClient) {
		super();

		// If the Cluster is spawned automatically or with an own controller.
		this.queue = { mode: this.info.ClusterQueueMode };

		// If the Cluster is under maintenance.
		this.maintenance = this.info.Maintenance;
		if (!this.maintenance) this.maintenance = false;

		// Wait 100ms so listener can be added.
		this.ready = false;
		this.process = (this.info.ClusterManagerMode === 'process' ? new ChildClient() : this.info.ClusterManagerMode === 'worker' ? new WorkerClient() : null);
		this.messageHandler = new ClusterClientHandler<InternalClient>(this);

		// Handle messages from the ClusterManager.
		this.process?.ipc?.on('message', this._handleMessage.bind(this));
		this.promise = new PromiseHandler();

		// Login the Client.
		if (this.info.AutoLogin) client.login(this.info.Token);

		client?.once?.('ready', () => {
			this.triggerReady();
		});
	}

	// Cluster's id.
	public get id() {
		return this.info.ClusterId;
	}

	// Array of shard Id's of this client.
	public get shards() {
		return this.client.ws.shards;
	}

	// Total number of shards.
	public get totalShards() {
		return this.client.ws.shards.size;
	}

	// Total number of clusters.
	public get totalClusters() {
		return this.info.ClusterCount;
	}

	// Gets some Info about the Cluster.
	public get info() {
		return getInfo();
	}

	// Sends a message to the Cluster as child. (Cluster, _handleMessage).
	public send(message: Serializable) {
		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);

		return this.process?.send({
			data: message,
			_type: MessageTypes.CustomMessage,
		} as BaseMessage<'normal'>);
	}

	// This is not intended to be used by the user.
	public _sendInstance(message: BaseMessage<DataType>) {
		if (!('_type' in message) || !('data' in message)) return Promise.reject(new Error('CLUSTERING_INVALID_MESSAGE | Invalid message object.' + JSON.stringify(message)));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
		return this.process?.send(message);
	}

	public async evalOnManager<T, P>(script: string | ((manager: ClusterManager, context: Serialized<P>) => Awaitable<T>), options?: { context?: P, timeout?: number }): Promise<T extends never ? unknown : Serialized<T>> {
		const nonce = ShardingUtils.generateNonce();

		this.process?.send({
			data: {
				options,
				script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`,
			},
			_nonce: nonce,
			_type: MessageTypes.ClientManagerEvalRequest,
		} as BaseMessage<'eval'>);

		return this.promise.create(nonce, options?.timeout);
	}

	public async broadcastEval<T, P>(script: string | ((client: InternalClient, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<(T extends never ? unknown : Serialized<T>)[]> {
		const nonce = ShardingUtils.generateNonce();

		this.process?.send({
			data: {
				options,
				script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`,
			},
			_nonce: nonce,
			_type: MessageTypes.ClientBroadcastRequest,
		} as BaseMessage<'eval'>);

		return this.promise.create(nonce, options?.timeout);
	}

	public async evalOnGuild<T, P>(guildId: string, script: string | ((client: InternalClient, context: Serialized<P>, guild: Guild) => Awaitable<T>), options?: { context?: P; timeout?: number; }): Promise<T extends never ? unknown : Serialized<T>> {
		const nonce = ShardingUtils.generateNonce();

		this.process?.send({
			data: {
				script: typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''}, this?.guilds?.cache?.get('${guildId}') || (() => { return Promise.reject(new Error('CLUSTERING_GUILD_NOT_FOUND | Guild with ID ${guildId} not found.')); })())`,
				options: {
					...options,
					guildId,
				},
			},
			_nonce: nonce,
			_type: MessageTypes.ClientBroadcastRequest,
		} as BaseMessage<'eval'>);

		return this.promise.create(nonce, options?.timeout).then((data) => (data as unknown as T[])?.[0]) as unknown as T extends never ? unknown : Serialized<T>;
	}

	public async evalOnClient<T, P>(script: string | ((client: InternalClient, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<T extends never ? unknown : Serialized<T>> {
		type EvalObject = { _eval: <T>(script: string) => T; };

		if ((this.client as unknown as EvalObject)._eval) return await (this.client as unknown as EvalObject)._eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
		(this.client as unknown as EvalObject)._eval = function (_: string) { return eval(_); }.bind(this.client);

		return await (this.client as unknown as EvalObject)._eval(typeof script === 'string' ? script : `(${script})(this${options?.context ? ', ' + JSON.stringify(options.context) : ''})`);
	}

	// Sends a Request to the ParentCluster and returns the reply.
	public request<O>(message: Serializable, options: { timeout?: number } = {}): Promise<Serialized<O>> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to.'));

		const nonce = ShardingUtils.generateNonce();

		this.process?.send({
			data: message,
			_type: MessageTypes.CustomRequest,
			_nonce: nonce,
		} as BaseMessage<'normal'>);

		return this.promise.create(nonce, options.timeout);
	}

	// Requests a respawn of all clusters.
	public respawnAll(options: { clusterDelay?: number; respawnDelay?: number; timeout?: number } = {}) {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to.'));

		return this.process?.send({
			data: options,
			_type: MessageTypes.ClientRespawnAll,
		} as BaseMessage<'respawn'>);
	}

	// Handles an IPC message.
	private _handleMessage(message: BaseMessage<'normal'>) {
		if (!message) return;

		// Debug.
		this.emit('debug', `[IPC] [Child ${this.id}] Received message from cluster.`);
		this.messageHandler?.handleMessage(message);

		// Emitted upon receiving a message from the child process/worker.
		if ([MessageTypes.CustomMessage, MessageTypes.CustomRequest].includes(message._type)) {
			this.emit('message', new ProcessMessage(this, message));
		}
	}

	// Sends a message to the master process, emitting an error from the client upon failure.
	public _respond<T extends DataType, D extends (Serializable | unknown) = Serializable>(type: T, message: BaseMessage<T, D>) {
		this.process?.send(message)?.catch((err) => this.client.emit('error', err));
	}

	// Triggers the ready event.
	public triggerReady() {
		this.ready = true;

		this.process?.send({
			_type: MessageTypes.ClientReady,
		} as BaseMessage<'readyOrSpawn'>);

		this.emit('ready', this);
		return this.ready;
	}

	// Whether the cluster should opt in maintenance when a reason was provided or opt-out when no reason was provided.
	public triggerMaintenance(maintenance: string, all = false) {
		this.maintenance = maintenance;

		this.process?.send({
			data: maintenance,
			_type: all ? MessageTypes.ClientMaintenanceAll : MessageTypes.ClientMaintenance,
		} as BaseMessage<'maintenance'>);

		return this.maintenance;
	}

	// Manually spawn the next cluster, when queue mode is on 'manual'.
	public spawnNextCluster() {
		if (this.queue.mode === 'auto') throw new Error('Next Cluster can just be spawned when the queue is not on auto mode.');

		return this.process?.send({
			_type: MessageTypes.ClientSpawnNextCluster,
		} as BaseMessage<'readyOrSpawn'>);
	}
}

// Credits for EventEmitter typings: https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/RequestManager.ts#L159
export interface ClusterClient {
	emit: (<K extends keyof ClusterClientEvents>(event: K, ...args: ClusterClientEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, ...args: unknown[]) => boolean);
    off: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    on: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    once: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    removeAllListeners: (<K extends keyof ClusterClientEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterClientEvents>) => this);
}
