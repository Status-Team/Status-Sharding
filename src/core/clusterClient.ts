import { ClusterClientEvents, EvalOptions, MessageTypes, Serialized, Awaitable, ValidIfSerializable, SerializableInput, ClusterClientData } from '../types';
import { BaseMessage, BaseMessageInput, DataType, ProcessMessage } from '../other/message';
import { BrokerMessage, IPCBrokerClient } from '../handlers/broker';
import { ClusterClientHandler } from '../handlers/message';
import { ShardingUtils } from '../other/shardingUtils';
import { RefClusterManager } from './clusterManager';
import { PromiseHandler } from '../handlers/promise';
import { WorkerClient } from '../classes/worker';
import { ChildClient } from '../classes/child';
import { Serializable } from 'child_process';
import { ShardingClient } from './client';
import { getInfo } from '../other/data';
import { Guild } from 'discord.js';
import EventEmitter from 'events';

export type RefShardingClient = ShardingClient;

/**
 * Simplified Cluster instance available on the {@link ClusterClient}.
 * @export
 * @class ClusterClient
 * @typedef {ClusterClient} [InternalClient=ShardingClient] - The client to use for the cluster.
 * @template {ShardingClient} [InternalClient=ShardingClient] - The client to use for the cluster.
 * @template {RefClusterManager} [InternalManager=RefClusterManager] - The manager to use for the cluster.
 * @template {RefCluster} [InternalCluster=RefCluster] - The cluster to use for the cluster.
 * @extends {EventEmitter} - The EventEmitter class.
 */
export class ClusterClient<
	InternalClient extends RefShardingClient = RefShardingClient,
	InternalManager extends RefClusterManager = RefClusterManager,
> extends EventEmitter {
	/**
	 * Ready state of the cluster.
	 * @type {boolean}
	 */
	public ready: boolean;
	/**
	 * Maintenance state of the cluster.
	 * @type {string}
	 */
	public maintenance: string;
	/**
	 * Handler that resolves sent messages and requests.
	 * @type {PromiseHandler}
	 */
	public promise: PromiseHandler;

	/**
	 * Client that manages broker tunnels.
	 * @readonly
	 * @type {IPCBrokerClient}
	 */
	readonly broker: IPCBrokerClient; // IPC Broker for the ClusterManager.
	/**
	 * Client that manages the cluster process.
	 * @readonly
	 * @type {(ChildClient | WorkerClient | null)}
	 */
	readonly process: ChildClient | WorkerClient | null;

	/**
	 * Handler that handles messages from the ClusterManager and the Cluster.
	 * @private
	 * @type {ClusterClientHandler<InternalClient>}
	 */
	private messageHandler: ClusterClientHandler<InternalClient>;

	/**
	 * Creates an instance of ClusterClient.
	 * @constructor
	 * @param {InternalClient} client - The client to use for the sharding.
	 */
	constructor(public client: InternalClient) {
		super();

		this.ready = false;
		this.maintenance = '';

		this.broker = new IPCBrokerClient(this);
		this.process = (this.info.ClusterManagerMode === 'process' ? new ChildClient() : this.info.ClusterManagerMode === 'worker' ? new WorkerClient() : null);
		this.messageHandler = new ClusterClientHandler<InternalClient>(this);

		// Handle messages from the ClusterManager.
		if (!this.process?.ipc) throw new Error('CLUSTERING_NO_PROCESS | No process to handle messages from.');
		this.process.ipc.on('message', this._handleMessage.bind(this));
		this.promise = new PromiseHandler(this);

		if (client?.once) client.once('ready', () => {
			setTimeout(() => this.triggerReady(), 1500); // Allow main listener to be called first.
		});
	}

	/**
	 * Current cluster id.
	 * @readonly
	 * @type {number} - The current cluster id.
	 */
	public get id(): number {
		return this.info.ClusterId;
	}

	/**
	 * Total number of shards.
	 * @readonly
	 * @type {number} - The total number of shards.
	 */
	public get totalShards(): number {
		return this.info.TotalShards;
	}

	/**
	 * Total number of clusters.
	 * @readonly
	 * @type {number} - The total number of clusters.
	 */
	public get totalClusters(): number {
		return this.info.ClusterCount;
	}

	/**
	 * Utility function to get some info about the cluster.
	 * @readonly
	 * @type {ClusterClientData}
	 */
	public get info(): ClusterClientData {
		return getInfo();
	}

	/**
	 * Sends a message to the Cluster as child. (goes to Cluster on _handleMessage).
	 * @template {Serializable} T - The type of the message.
	 * @param {(SerializableInput<T, true> | unknown)} message - The message to send.
	 * @returns {Promise<void>} A promise that resolves when the message was sent.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @example
	 * client.cluster.send({ type: 'ping' });
	 * client.cluster.send('ping');
	 * client.cluster.send(123);
	 * client.cluster.send(true);
	 * client.cluster.send({ type: 'ping' }, { timeout: 5000 });
	 */
	public send<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#1).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#1).'));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);

		return this.process.send({
			data: message,
			_type: MessageTypes.CustomMessage,
		} as BaseMessage<'normal'>) as Promise<void>;
	}

	/**
	 * Broadcasts a message to all clusters.
	 * @template {Serializable} T - The type of the message.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @param {boolean} [sendSelf=false] - Whether to send the message to the current cluster as well.
	 * @returns {Promise<void>} A promise that resolves when the message was sent.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @example
	 * client.cluster.broadcast({ type: 'ping' });
	 * client.cluster.broadcast('ping');
	 * client.cluster.broadcast(123);
	 * client.cluster.broadcast(true);
	 * client.cluster.broadcast({ type: 'ping' }, true);
	 */
	public broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf: boolean = false): Promise<void> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#2).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#2).'));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);

		return this.process.send<BaseMessageInput<'normal'>>({
			data: {
				message,
				ignore: sendSelf ? undefined : this.id,
			},
			_type: MessageTypes.ClientBroadcast,
		}) as Promise<void>;
	}

	/**
	 * Sends a message to the Cluster.
	 * @template {DataType} D - The type of the message.
	 * @template {Serializable} A - The type of the message.
	 * @template {object} P - The type of the message.
	 * @param {BaseMessage<D, A, P>} message - The message to send.
	 * @returns {Promise<void>} A promise that resolves when the message was sent.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @example
	 * client.cluster.sendInstance({ _type: MessageTypes.CustomMessage, _nonce: '1234567890', data: { id: '797012765352001557', username: 'Digital', discriminator: '3999' } });
	 */
	public _sendInstance<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): Promise<void> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#3).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#3).'));
		else if (!('_type' in message) || !('data' in message)) return Promise.reject(new Error('CLUSTERING_INVALID_MESSAGE | Invalid message object.' + JSON.stringify(message)));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);
		return this.process.send(message) as Promise<void>;
	}

	/**
	 * Evaluates a script on the master process, in the context of the {@link ClusterManager}.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [M=InternalManager] - The type of the manager.
	 * @param {(((manager: M, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?{ context?: P, timeout?: number }} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>>} A promise that resolves with the result of the eval.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @throws {Error} - When the script is not a function.
	 * @example
	 * client.cluster.evalOnManager((manager, context) => {
	 *    return manager.clusters.size;
	 * }); // 8 (8 clusters)
	 */
	public async evalOnManager<T, P extends object, M = InternalManager>(script: ((manager: M, context: Serialized<P>) => Awaitable<T>), options?: { context?: P, timeout?: number }): Promise<ValidIfSerializable<T>> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#4).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#4).'));
		else if (typeof script !== 'function') return Promise.reject(new Error('CLUSTERING_INVALID_EVAL_SCRIPT | Eval script is not a function (#1).'));

		const nonce = ShardingUtils.generateNonce();

		this.process.send<BaseMessage<'eval'>>({
			data: {
				options,
				script: `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`,
			},
			_nonce: nonce,
			_type: MessageTypes.ClientManagerEvalRequest,
		});

		return this.promise.create(nonce, options?.timeout);
	}

	/**
	 * Evaluates a script on all clusters in parallel.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [C=InternalClient] - The type of the client.
	 * @param {(string | ((client: C, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?EvalOptions<P>} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>[]>} A promise that resolves with the result of the eval.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @throws {Error} - When the script is not a function or string.
	 * @example
	 * client.cluster.broadcastEval((client, context) => {
	 *   return client.guilds.cache.size;
	 * }); // [ 23, 23, 23, 23, 23, 23, 23, 23 ] (8 clusters)
	 */
	public async broadcastEval<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>[]> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#5).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#5).'));
		else if (typeof script !== 'string' && typeof script !== 'function') return Promise.reject(new Error('CLUSTERING_INVALID_EVAL_SCRIPT | Eval script is not a function or string.'));

		const nonce = ShardingUtils.generateNonce();

		this.process.send({
			data: {
				options,
				script: typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`,
			},
			_nonce: nonce,
			_type: MessageTypes.ClientBroadcastRequest,
		} as BaseMessage<'eval'>);

		return this.promise.create(nonce, options?.timeout);
	}

	/**
	 * Evaluates a script on specific guild.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [C=InternalClient] - The type of the client.
	 * @template {boolean} [E=false] - Whether to use experimental mode.
	 * @param {string} guildId - The ID of the guild to use.
	 * @param {((client: C, context: Serialized<P>, guild: Guild) => Awaitable<T>)} script - The script to evaluate.
	 * @param {?{ context?: P; timeout?: number; experimental?: E; }} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>>} A promise that resolves with the result of the eval.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @throws {Error} - When the script is not a function.
	 * @throws {Error} - When no guild id was provided.
	 * @example
	 * client.cluster.evalOnGuild('945340723425837066', (client, context, guild) => {
	 *  return guild.name;
	 * }); // Digital's Basement
	 */
	public async evalOnGuild<T, P extends object, C = InternalClient, E extends boolean = false>(guildId: string, script: (client: C, context: Serialized<P>, guild: E extends true ? Guild : Guild | undefined) => Awaitable<T>, options?: { context?: P; timeout?: number; experimental?: E; }): Promise<ValidIfSerializable<T>> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#6).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#6).'));
		else if (typeof script !== 'function') return Promise.reject(new Error('CLUSTERING_INVALID_EVAL_SCRIPT | Eval script is not a function (#2).'));
		else if (typeof guildId !== 'string') return Promise.reject(new TypeError('CLUSTERING_GUILD_ID_INVALID | Guild Id must be a string.'));

		const nonce = ShardingUtils.generateNonce();

		this.process.send({
			data: {
				script: `(${options?.experimental ? ShardingUtils.guildEvalParser(script) : script})(this,${options?.context ? JSON.stringify(options.context) : undefined},this?.guilds?.cache?.get('${guildId}'))`,
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

	/**
	 * Evaluates a script on a current client, in the context of the {@link ShardingClient}.
	 * @async
	 * @template {unknown} T - The type of the result.
	 * @template {object} P - The type of the context.
	 * @template {unknown} [C=InternalClient] - The type of the client.
	 * @param {(string | ((client: C, context: Serialized<P>) => Awaitable<T>))} script - The script to evaluate.
	 * @param {?EvalOptions<P>} [options] - The options for the eval.
	 * @returns {Promise<ValidIfSerializable<T>>} A promise that resolves with the result of the eval.
	 * @example
	 * client.cluster.evalOnClient((client, context) => {
	 * 	return client.guilds.cache.size;
	 * }); // 23
	 */
	public async evalOnClient<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		type EvalObject = { _eval: <T>(script: string) => T; };

		if ((this.client as unknown as EvalObject)._eval) return await (this.client as unknown as EvalObject)._eval(typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`);
		(this.client as unknown as EvalObject)._eval = function (_: string) { return (0, eval)(_); }.bind(this.client);

		return await (this.client as unknown as EvalObject)._eval(typeof script === 'string' ? script : `(${script})(this,${options?.context ? JSON.stringify(options.context) : undefined})`);
	}

	/**
	 * Sends a request to the Cluster (cluster has to respond with a reply (cluster.on('message', (message) => message.reply('reply')))).
	 * @template {Serializable} T - The type of the message.
	 * @param {SerializableInput<T>} message - The message to send.
	 * @param {{ timeout?: number }} [options={}] - The options for the request.
	 * @returns {Promise<ValidIfSerializable<T>>} A promise that resolves with the result of the request.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @example
	 * client.cluster.request({ type: 'ping' });
	 * client.cluster.request('ping');
	 * client.cluster.request(123);
	 */
	public request<T extends Serializable>(message: SerializableInput<T>, options: { timeout?: number } = {}): Promise<ValidIfSerializable<T>> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#7).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#7).'));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);

		const nonce = ShardingUtils.generateNonce();

		this.process.send<BaseMessage<'normal'>>({
			data: message,
			_type: MessageTypes.CustomRequest,
			_nonce: nonce,
		});

		return this.promise.create(nonce, options.timeout);
	}

	/**
	 * Respawns all clusters.
	 * @param {{ clusterDelay?: number; respawnDelay?: number; timeout?: number }} [options={}] - The options for the respawn.
	 * @returns {Promise<void>} A promise that resolves when the message was sent.
	 */
	public respawnAll(options: { clusterDelay?: number; respawnDelay?: number; timeout?: number } = {}): Promise<void> {
		if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#8).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#8).'));

		this.emit('debug', `[IPC] [Child ${this.id}] Sending message to cluster.`);

		return this.process.send({
			data: options,
			_type: MessageTypes.ClientRespawnAll,
		} as BaseMessage<'respawn'>);
	}

	/**
	 * Handles a message from the ClusterManager.
	 * @private
	 * @param {(BaseMessage<'normal'> | BrokerMessage)} message - The message to handle.
	 * @returns {void} A promise that resolves when the message was sent.
	 */
	private _handleMessage(message: BaseMessage<'normal'> | BrokerMessage): void {
		if (!message || '_data' in message) return this.broker.handleMessage(message);

		// Debug.
		this.emit('debug', `[IPC] [Child ${this.id}] Received message from cluster.`);
		this.messageHandler.handleMessage(message);

		// Emitted upon receiving a message from the child process/worker.
		if ([MessageTypes.CustomMessage, MessageTypes.CustomRequest].includes(message._type)) {
			this.emit('message', new ProcessMessage(this, message));
		}
	}

	/**
	 * Sends a message to the master process.
	 * @template {DataType} D - The type of the message.
	 * @template {Serializable} A - The type of the message.
	 * @template {object} P - The type of the message.
	 * @param {BaseMessage<D, A, P>} message - The message to send.
	 * @returns {void} A promise that resolves when the message was sent.
	 * @throws {Error} - When there is no process to send the message to.
	 */
	public _respond<D extends DataType, A = Serializable, P extends object = object>(message: BaseMessage<D, A, P>): void {
		if (!this.process) throw new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#9).');
		this.process.send(message);
	}

	/**
	 * Triggers the ready event, do not use this unless you know what you are doing.
	 * @returns {boolean} Whether the cluster is ready or not.
	 */
	public triggerReady(): boolean {
		if (this.ready) return this.ready;
		else if (!this.process) throw new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#10).');

		this.ready = true;

		this.process.send({
			_type: MessageTypes.ClientReady,
		} as BaseMessage<'readyOrSpawn'>);

		this.emit('ready', this);
		return this.ready;
	}

	/**
	 * Triggers the maintenance event.
	 * @param {string} maintenance - The maintenance message.
	 * @param {boolean} [all=false] - Whether to send the maintenance message to all clusters.
	 * @returns {string} The maintenance message.
	 * @throws {Error} - When there is no process to send the message to.
	 */
	public triggerMaintenance(maintenance: string, all: boolean = false): string {
		if (this.maintenance === maintenance) return this.maintenance;
		else if (!this.process) throw new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#11).');

		this.maintenance = maintenance;

		this.process.send({
			data: maintenance,
			_type: all ? MessageTypes.ClientMaintenanceAll : MessageTypes.ClientMaintenance,
		} as BaseMessage<'maintenance'>);

		return this.maintenance;
	}

	/**
	 * Spawns the next cluster, when queue mode is on 'manual'.
	 * @returns {void} A promise that resolves when the message was sent.
	 * @throws {Error} - When the queue mode is not on 'manual'.
	 * @throws {Error} - When there is no process to send the message to.
	 * @throws {Error} - When the cluster is not ready yet.
	 * @example
	 * client.cluster.spawnNextCluster();
	 * client.cluster.spawnNextCluster().catch(console.error);
	 */
	public spawnNextCluster(): Promise<void> {
		if (this.info.ClusterQueueMode === 'auto') throw new Error('Next Cluster can just be spawned when the queue is not on auto mode.');
		else if (!this.process) return Promise.reject(new Error('CLUSTERING_NO_PROCESS_TO_SEND_TO | No process to send the message to (#12).'));
		else if (!this.ready) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster is not ready yet (#9).'));

		return this.process.send({
			_type: MessageTypes.ClientSpawnNextCluster,
		} as BaseMessage<'readyOrSpawn'>);
	}

	/**
	 * Kills the cluster.
	 * @param {string} message - The message to send to the ClusterManager.
	 * @returns {void} A promise that resolves when the message was sent.
	 */
	public _debug(message: string): void {
		this.emit('debug', message);
	}
}

export type RefClusterClient = ClusterClient;

// Credits for EventEmitter typings: https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/RequestManager.ts#L159
/**
 * Modified ClusterClient with bunch of new methods.
 * @export
 * @interface ClusterClient
 * @typedef {ClusterClient}
 */
export declare interface ClusterClient {
	/**
	 * Emit an event.
	 * @type {(<K extends keyof ClusterClientEvents>(event: K, ...args: ClusterClientEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, ...args: unknown[]) => boolean)}
	 */
	emit: (<K extends keyof ClusterClientEvents>(event: K, ...args: ClusterClientEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, ...args: unknown[]) => boolean);
    /**
	 * Remove an event listener.
	 * @type {(<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	off: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    /**
	 * Listen for an event.
	 * @type {(<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	on: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    /**
	 * Listen for an event once.
	 * @type {(<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this)}
	 */
	once: (<K extends keyof ClusterClientEvents>(event: K, listener: (...args: ClusterClientEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClusterClientEvents>, listener: (...args: unknown[]) => void) => this);
    /**
	 * Remove all listeners for an event.
	 * @type {(<K extends keyof ClusterClientEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterClientEvents>) => this)}
	 */
	removeAllListeners: (<K extends keyof ClusterClientEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClusterClientEvents>) => this);
}
