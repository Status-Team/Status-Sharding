import { ClusterClientEvents, EvalOptions, MessageTypes, Serialized, Awaitable, ValidIfSerializable, SerializableInput } from '../types';
import { BaseMessage, BaseMessageInput, DataType, ProcessMessage } from '../other/message';
import { ClientOptions, Client as DiscordClient, Guild, ClientEvents } from 'discord.js';
import { BrokerMessage, IPCBrokerClient } from '../handlers/broker';
import { ClusterClientHandler } from '../handlers/message';
import { ShardingUtils } from '../other/shardingUtils';
import { PromiseHandler } from '../handlers/promise';
import { ClusterManager } from './clusterManager';
import { WorkerClient } from '../classes/worker';
import { ChildClient } from '../classes/child';
import { Serializable } from 'child_process';
import { getInfo } from '../other/data';
import EventEmitter from 'events';

export type ClientEventsModifiable = Omit<ClientEvents, 'ready'> & { ready: [client: ShardingClient] };

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

	on<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	on<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
	on(event: string | symbol, listener: (...args: unknown[]) => void): this {
		return super.on(event, listener);
	}

	once<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	once<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
	once(event: string | symbol, listener: (...args: unknown[]) => void): this {
		return super.once(event, listener);
	}

	off<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	off<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
	off(event: string | symbol, listener: (...args: unknown[]) => void): this {
		return super.off(event, listener);
	}

	emit<K extends keyof ClientEventsModifiable>(event: K, ...args: ClientEventsModifiable[K]): boolean;
	emit<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, ...args: unknown[]): boolean;
	emit(event: string | symbol, ...args: unknown[]): boolean {
		return super.emit(event, ...args);
	}
}

export class ClusterClient<InternalClient extends ShardingClient = ShardingClient> extends EventEmitter {
	public ready: boolean;
	public maintenance: string;
	public promise: PromiseHandler;

	readonly broker: IPCBrokerClient; // IPC Broker for the ClusterManager.
	readonly process: ChildClient | WorkerClient | null;

	private messageHandler: ClusterClientHandler<InternalClient>;

	constructor(public client: InternalClient) {
		super();

		this.ready = false;
		this.maintenance = '';

		this.broker = new IPCBrokerClient(this);
		this.process = (this.info.ClusterManagerMode === 'process' ? new ChildClient() : this.info.ClusterManagerMode === 'worker' ? new WorkerClient() : null);
		this.messageHandler = new ClusterClientHandler<InternalClient>(this);

		// Handle messages from the ClusterManager.
		this.process?.ipc?.on('message', this._handleMessage.bind(this));
		this.promise = new PromiseHandler();

		if (client?.once) client.once('ready', () => {
			setTimeout(() => this.triggerReady(), 1500); // Allow main listener to be called first.
		});
	}

	// Cluster's id.
	public get id() {
		return this.info.ClusterId;
	}

	// Total number of shards.
	public get totalShards() {
		return this.info.TotalShards;
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
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);

		return this.process?.send({
			data: message,
			_type: MessageTypes.CustomMessage,
		} as BaseMessage<'normal'>) as Promise<void>;
	}

	public broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf = false): Promise<void> {
		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);

		return this.process?.send<BaseMessageInput<'normal'>>({
			data: {
				message,
				ignore: sendSelf ? undefined : this.id,
			},
			_type: MessageTypes.ClientBroadcast,
		}) as Promise<void>;
	}

	// This is not intended to be used by the user.
	public _sendInstance(message: BaseMessage<DataType>): Promise<void> {
		if (!('_type' in message) || !('data' in message)) return Promise.reject(new Error('CLUSTERING_INVALID_MESSAGE | Invalid message object.' + JSON.stringify(message)));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
		return this.process?.send(message) as Promise<void>;
	}

	public async evalOnManager<T, P extends object, M = ClusterManager>(script: string | ((manager: M, context: Serialized<P>) => Awaitable<T>), options?: { context?: P, timeout?: number }): Promise<ValidIfSerializable<T>> {
		const nonce = ShardingUtils.generateNonce();

		this.process?.send<BaseMessage<'eval'>>({
			data: {
				options,
				script: typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`,
			},
			_nonce: nonce,
			_type: MessageTypes.ClientManagerEvalRequest,
		});

		return this.promise.create(nonce, options?.timeout);
	}

	public async broadcastEval<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>[]> {
		const nonce = ShardingUtils.generateNonce();

		this.process?.send({
			data: {
				options,
				script: typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`,
			},
			_nonce: nonce,
			_type: MessageTypes.ClientBroadcastRequest,
		} as BaseMessage<'eval'>);

		return this.promise.create(nonce, options?.timeout);
	}

	public async evalOnGuild<T, P extends object, C = InternalClient>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild?: Guild) => Awaitable<T>), options?: { context?: P; timeout?: number; }): Promise<ValidIfSerializable<T>> {
		const nonce = ShardingUtils.generateNonce();

		this.process?.send({
			data: {
				script: ShardingUtils.guildEvalParser(typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined},this?.guilds?.cache?.get('${guildId}'))`),
				options: {
					...options,
					guildId,
				},
			},
			_nonce: nonce,
			_type: MessageTypes.ClientBroadcastRequest,
		} as BaseMessage<'eval'>);

		return this.promise.create(nonce, options?.timeout).then((data) => (data as unknown as T[])?.find((v) => v !== undefined)) as Promise<ValidIfSerializable<T>>;
	}

	public async evalOnClient<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		type EvalObject = { _eval: <T>(script: string) => T; };

		if ((this.client as unknown as EvalObject)._eval) return await (this.client as unknown as EvalObject)._eval(typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`);
		(this.client as unknown as EvalObject)._eval = function (_: string) { return (0, eval)(_); }.bind(this.client);

		return await (this.client as unknown as EvalObject)._eval(typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`);
	}

	// Sends a Request to the ParentCluster and returns the reply.
	public request<T extends Serializable>(message: SerializableInput<T>, options: { timeout?: number } = {}): Promise<ValidIfSerializable<T>> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to.'));

		const nonce = ShardingUtils.generateNonce();

		this.process?.send<BaseMessage<'normal'>>({
			data: message,
			_type: MessageTypes.CustomRequest,
			_nonce: nonce,
		});

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
	private _handleMessage(message: BaseMessage<'normal'> | BrokerMessage) {
		if (!message || '_data' in message) return this.broker.handleMessage(message);

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
		if (this.info.ClusterQueueMode === 'auto') throw new Error('Next Cluster can just be spawned when the queue is not on auto mode.');

		return this.process?.send({
			_type: MessageTypes.ClientSpawnNextCluster,
		} as BaseMessage<'readyOrSpawn'>);
	}
}

// Credits for EventEmitter typings: https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/RequestManager.ts#L159
export declare interface ClusterClient {
	emit: (<K extends keyof ClusterClientEvents>(event: K, ...args: ClusterClientEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, ...args: unknown[]) => boolean);
    off: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    on: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    once: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    removeAllListeners: (<K extends keyof ClusterClientEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterClientEvents>) => this);
}
