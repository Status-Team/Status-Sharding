import { MessageTypes, type Awaitable, type BaseMessage, type ClusterClientData, type ClusterClientEvents, type DataType, type EvalOptions, type PackageType, type RefClusterManager, type Serializable, type SerializableInput, type Serialized, type ValidIfSerializable, type ClientRefType } from '../types.js';
import { ProcessMessage, brokerPayloadFromValue, isBaseMessage } from '../other/message.js';
import { ShardingUtils } from '../other/shardingUtils.js';
import { PromiseHandler } from '../handlers/promise.js';
import { IPCBrokerClient } from '../handlers/broker.js';
import { WorkerClient } from '../classes/worker.js';
import { ChildClient } from '../classes/child.js';
import { getInfo } from '../other/utils.js';
import type { Guild } from 'discord.js';
import EventEmitter from 'node:events';

interface QueuedReadyOperation {
	name: string;
	run: () => Promise<void>;
	reject: (error: Error) => void;
}

export class ClusterClient<
	InternalClient extends ClientRefType = ClientRefType,
	InternalManager extends RefClusterManager = RefClusterManager,
> extends EventEmitter {
	public ready = false;
	public readonly promise: PromiseHandler;
	public readonly broker: IPCBrokerClient;
	public readonly process: ChildClient | WorkerClient;

	private readonly infoData: ClusterClientData;
	private readonly packageType: PackageType | null;
	private readonly queueUntilReady: boolean;
	private readonly readyQueue: QueuedReadyOperation[] = [];
	private flushingReadyQueue = false;

	constructor (public readonly client: InternalClient) {
		super();

		this.infoData = getInfo();
		this.packageType = this.detectPackage(client);
		this.queueUntilReady = this.infoData.QueueUntilReady;
		this.process = this.infoData.ClusterManagerMode === 'process'
			? new ChildClient({ ipcTimeout: this.infoData.IpcTimeout, ipcMaxPayload: this.infoData.IpcMaxPayload })
			: new WorkerClient({ ipcMaxPayload: this.infoData.IpcMaxPayload });

		this.promise = new PromiseHandler(this.infoData.IpcTimeout, this.infoData.IpcMaxPending);
		this.broker = new IPCBrokerClient((channelName, message) => this.sendBroker(channelName, message), (message) => this._debug(message));

		this.attachTransport();
	}

	public get id(): number {
		return this.infoData.ClusterId;
	}

	public get totalShards(): number {
		return this.infoData.TotalShards;
	}

	public get totalClusters(): number {
		return this.infoData.ClusterCount;
	}

	public get info(): ClusterClientData {
		return this.infoData;
	}

	/* ----------------------------------- Transport ----------------------------------- */

	private detectPackage(client: object): PackageType | null {
		if ('guilds' in client && 'login' in client) return 'discord.js';
		if ('gateway' in client && 'rest' in client) return '@discordjs/core';
		return null;
	}

	private attachTransport(): void {
		if (this.infoData.ClusterManagerMode === 'process') {
			const ipc = this.process.ipc;
			if (!ipc) return;

			ipc.on('message', (message: unknown) => this.handleMessage(message));
			ipc.once('disconnect', () => this.markUnready());
		} else if (this.process.ipc) {
			this.process.ipc.on('message', (message: unknown) => this.handleMessage(message));
			this.process.ipc.once('close', () => this.markUnready());
		}
	}

	private markUnready(): void {
		this.ready = false;
		const error = new Error('IPC_CHANNEL_CLOSED | Manager IPC channel closed.');

		this.promise.rejectAll(error);
		this.rejectReadyQueue(error);
		this.emitSafe('unready', this);
	}

	private handleMessage(message: unknown): void {
		if (!isBaseMessage(message)) return;

		const wire = message;
		switch (wire._type) {
			case MessageTypes.Heartbeat:
				void this.replyHeartbeat(wire);
				return;

			case MessageTypes.ManagerReady:
				this.emitSafe('managerReady');
				return;

			case MessageTypes.BrokerMessage: {
				const data = brokerPayloadFromValue(wire.data);
				if (data) this.broker._receive(data.broker, data.message);
				return;
			}

			case MessageTypes.CustomMessage:
			case MessageTypes.CustomRequest:
				this.emitSafe('message', new ProcessMessage(this, wire));
				return;

			case MessageTypes.ClientEvalRequest:
				void this.evaluateForClient(wire);
				return;

			case MessageTypes.CustomReply:
			case MessageTypes.ClientBroadcastResponse:
			case MessageTypes.ClientManagerEvalResponse:
			case MessageTypes.ClientEvalResponseError:
			case MessageTypes.ClientBroadcastResponseError:
			case MessageTypes.ClientManagerEvalResponseError:
				if (!wire._nonce) return;
				if (isErrorResponseType(wire._type)) this.promise.reject(wire._nonce, new Error(errorMessageFromData(wire.data)));
				else this.promise.resolve(wire._nonce, wire.data);
				return;

			case MessageTypes.ClientRespawnAll:
			case MessageTypes.ClientRespawnSpecific:
			case MessageTypes.ClientSpawnNextCluster:
			default:
				return;
		}
	}

	/* ----------------------------------- Handlers ----------------------------------- */

	private async replyHeartbeat(message: BaseMessage<DataType>): Promise<void> {
		const data = heartbeatRequestFromData(message.data);
		if (!data) return;

		let healthy = false;
		try {
			healthy = await this.isReadyForHeartbeatAck();
		} catch (error: unknown) {
			this._debug(`The heartbeat health check failed with ${error instanceof Error ? error.message : String(error)}; the cluster will report unhealthy.`);
		}

		await this._respond({
			_type: MessageTypes.HeartbeatAck,
			_nonce: message._nonce,
			data: { nonce: data.nonce, receivedAt: Date.now(), ready: healthy },
		}).catch((error: unknown) => this._debug(`The heartbeat response failed with ${error instanceof Error ? error.message : String(error)}.`));
	}

	private async evaluateForClient(message: BaseMessage<DataType>): Promise<void> {
		if (!message._nonce || !message.data || typeof message.data !== 'object' || !('script' in message.data)) return;

		try {
			const data = evalRequestFromData(message.data);
			if (!data) return;
			const result = typeof data.options?.guildId === 'string'
				? await this.evalOnGuild(data.options.guildId, data.script, data.options)
				: await this.evaluateScript(data.script, data.options?.context, data.options);

			if (!ShardingUtils.isSerializable(result)) throw new Error('CLUSTERING_EVAL_RESULT_INVALID | Evaluation returned a non-serializable value.');
			await this._respond({ _type: MessageTypes.ClientEvalResponse, _nonce: message._nonce, data: result });
		} catch (error: unknown) {
			await this._respond({
				_type: MessageTypes.ClientEvalResponseError,
				_nonce: message._nonce,
				data: {
					name: error instanceof Error ? error.name : 'Error',
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	/* ----------------------------------- Evaluation ----------------------------------- */

	private async evaluateScript<T>(script: string, context?: unknown, options?: EvalOptions): Promise<T> {
		const callable = /^\s*(?:async\s+)?function\b/.test(script) || script.includes('=>');
		const guild =
			options?.guildId && this.packageType === 'discord.js'
				? `(client?.guilds?.cache?.get(${JSON.stringify(options.guildId)}))`
				: 'undefined';

		const discordGuild =
			options?.guildId && this.packageType === 'discord.js'
				? `(this?.guilds?.cache?.get(${JSON.stringify(options.guildId)}))`
				: 'undefined';

		const functionBody = `return ${callable ? `(${script})(client, context, ${guild})` : `(${script})`}`;

		if (this.packageType === 'discord.js') {
			const candidate = evalFunction<T>(this.client);
			const source = callable
				? `(${script})(this,${context === undefined ? 'undefined' : JSON.stringify(context)},${discordGuild})`
				: script;

			if (candidate) return await candidate.call(this.client, source);
			return await new Function('client', 'context', functionBody).call(this.client, this.client, context);
		}

		return await new Function('client', 'context', functionBody).call(this.client, this.client, context);
	}

	public async isReadyForHeartbeatAck(): Promise<boolean> {
		if (this.packageType === 'discord.js') {
			const readyFunction = readyFunctionFor(this.client);
			if (readyFunction) return readyFunction.call(this.client);
			return readyAtFor(this.client) !== null;
		}

		if (this.packageType === '@discordjs/core') {
			const statuses = await coreShardStatusesFor(this.client);
			return statuses ? this.infoData.ShardList.every((id) => statuses.get(id) === 3) : this.ready;
		}

		return this.ready;
	}

	public async getShardHealth(): Promise<Array<{ id: number; ready: boolean; status?: number }>> {
		if (this.packageType === 'discord.js') {
			const shards = shardMapFor(this.client);
			return this.infoData.ShardList.map((id) => ({ id, ready: shards?.get(id)?.status === 0, status: shards?.get(id)?.status }));
		}

		if (this.packageType === '@discordjs/core') {
			const statuses = await coreShardStatusesFor(this.client);
			return this.infoData.ShardList.map((id) => ({ id, ready: statuses?.get(id) === 3, status: statuses?.get(id) }));
		}
		
		return this.infoData.ShardList.map((id) => ({ id, ready: this.ready }));
	}

	/* ----------------------------------- IPC ----------------------------------- */

	public async _applyHealthState(healthy: boolean, reason = 'Discord gateway became unhealthy.'): Promise<void> {
		if (healthy) {
			if (!this.ready) await this.triggerReady();
			return;
		}

		if (!this.ready) return;

		this.ready = false;
		this.emitSafe('unready', this);

		await this._respond({ _type: MessageTypes.ClientUnready, data: { reason } });
	}

	public async send<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		return this.ensureReady('send', async () => {
			await this.process.send({ _type: MessageTypes.CustomMessage, data: message });
		});
	}

	public async broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf = false): Promise<void> {
		return this.ensureReady('broadcast', async () => {
			await this.process.send({
				_type: MessageTypes.ClientBroadcast,
				data: { message, ignore: sendSelf ? undefined : this.id },
			});
		});
	}

	private sendBroker<T extends Serializable>(channelName: string, message: SerializableInput<T>): Promise<void> {
		return this.ensureReady('broker.send', async () => {
			await this.process.send({ _type: MessageTypes.BrokerMessage, data: { broker: channelName, _data: message } });
		});
	}

	public request<T extends Serializable, O = unknown>(message: SerializableInput<T>, options: { timeout?: number } = {}): Promise<Serialized<O>> {
		return this.ensureReady('request', () => this.requestWithNonce<Serialized<O>>({ _type: MessageTypes.CustomRequest, data: message }, options.timeout));
	}

	public evalOnManager<T, P extends object, M = InternalManager>(script: (manager: M, context: Serialized<P>) => Awaitable<T>, options?: { context?: P; timeout?: number }): Promise<ValidIfSerializable<T>> {
		return this.ensureReady('evalOnManager', () => this.requestWithNonce<ValidIfSerializable<T>>({ _type: MessageTypes.ClientManagerEvalRequest, data: { script: script.toString(), options } }, options?.timeout));
	}

	public broadcastEval<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>[]> {
		return this.ensureReady('broadcastEval', () => this.requestWithNonce<ValidIfSerializable<T>[]>({
			_type: MessageTypes.ClientBroadcastRequest,
			data: { script: typeof script === 'function' ? script.toString() : script, options },
		}, options?.timeout));
	}

	public evalOnClient<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>>;

	public async evalOnClient<T, P extends object>(script: string | ((client: InternalClient, context: Serialized<P> | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		return this.ensureReady('evalOnClient', async () => {
			if (typeof script === 'function') return script(this.client, options?.context);
			return await this.evaluateScript<T>(script, options?.context);
		});
	}

	public evalOnGuild<T, P extends object, C = InternalClient, E extends boolean = false>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild: E extends true ? Guild : Guild | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>>;

	public async evalOnGuild<T, P extends object>(guildId: string, script: string | ((client: InternalClient, context: Serialized<P> | undefined, guild: Guild | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		return this.ensureReady('evalOnGuild', async () => {
			if (this.packageType !== 'discord.js') throw new Error('CLUSTERING_EVAL_GUILD_UNSUPPORTED | evalOnGuild requires discord.js.');
			const guild = guildFor(this.client, guildId);

			if (typeof script === 'string') return await this.evaluateScript<T>(script, options?.context, { ...options, guildId });
			return script(this.client, options?.context, guild);
		});
	}

	public async respawnAll(clusterDelay = 8_000, respawnDelay = 5_500, timeout = -1, except: number[] = []): Promise<void> {
		return this.ensureReady('respawnAll', async () => {
			await this.process.send({ _type: MessageTypes.ClientRespawnAll, data: { clusterDelay, respawnDelay, timeout, except } });
		});
	}

	public async respawnClusters(clusters: number[], clusterDelay = 8_000, respawnDelay = 5_500, timeout = -1): Promise<void> {
		return this.ensureReady('respawnClusters', async () => {
			await this.process.send({
				_type: MessageTypes.ClientRespawnSpecific,
				data: { clusterIds: clusters, clusterDelay, respawnDelay, timeout },
			});
		});
	}

	public async spawnNextCluster(): Promise<void> {
		return this.ensureReady('spawnNextCluster', async () => {
			await this.process.send({ _type: MessageTypes.ClientSpawnNextCluster });
		});
	}

	public async triggerReady(): Promise<boolean> {
		if (this.ready) {
			void this.flushReadyQueue();
			return true;
		}

		await this._respond({ _type: MessageTypes.ClientReady, data: { packageType: this.packageType } });
		this.ready = true;
		this.emitSafe('ready', this);
		this._debug(`The cluster client became ready and is releasing ${this.readyQueue.length} queued operation(s).`);
		void this.flushReadyQueue();

		return true;
	}

	public _sendInstance(message: BaseMessage<DataType>): Promise<void> {
		return this.process.send(message);
	}

	public _respond(message: BaseMessage<DataType>): Promise<void> {
		return this.process.send(message);
	}

	public _debug(message: string): void {
		this.emitSafe('debug', message);
	}

	private async requestWithNonce<T>(message: BaseMessage<DataType>, timeout = this.infoData.IpcTimeout): Promise<T> {
		const nonce = message._nonce ?? ShardingUtils.generateNonce();
		message._nonce = nonce;

		const pending = this.promise.create<T>(nonce, timeout);
		try {
			await this.process.send(message);
		} catch (error: unknown) {
			this.promise.reject(nonce, error instanceof Error ? error : new Error(String(error)));
		}

		return await pending;
	}

	private ensureReady<T>(name: string, operation: () => Promise<T>): Promise<T> {
		if (this.ready) return this.runReadyOperation(name, operation);
		if (!this.queueUntilReady) return Promise.reject(new Error('CLUSTERING_NOT_READY | Cluster client is not ready.'));

		this._debug(`The ${name} operation was queued because the cluster client is not ready.`);
		return new Promise<T>((resolve, reject) => {
			this.readyQueue.push({
				name,
				reject,
				run: async () => {
					try {
						resolve(await this.runReadyOperation(name, operation));
					} catch (error: unknown) {
						reject(error);
					}
				},
			});
		});
	}

	private async runReadyOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (error: unknown) {
			this._debug(`The ${name} operation failed with ${error instanceof Error ? error.message : String(error)}.`);
			throw error;
		}
	}

	private async flushReadyQueue(): Promise<void> {
		if (this.flushingReadyQueue || !this.ready) return;
		this.flushingReadyQueue = true;

		try {
			while (this.ready && this.readyQueue.length) {
				const operation = this.readyQueue.shift();
				if (!operation) continue;
				this._debug(`The queued ${operation.name} operation is firing now that the cluster client is ready.`);
				await operation.run();
			}
		} finally {
			this.flushingReadyQueue = false;
			if (this.ready && this.readyQueue.length) void this.flushReadyQueue();
		}
	}

	private rejectReadyQueue(error: Error): void {
		while (this.readyQueue.length) {
			const operation = this.readyQueue.shift();
			if (!operation) continue;
			this._debug(`The queued ${operation.name} operation was rejected because the cluster IPC channel closed.`);
			operation.reject(error);
		}
	}

	private emitSafe(event: string, ...args: unknown[]): void {
		for (const listener of this.rawListeners(event)) {
			try {
				Reflect.apply(listener, this, args);
			} catch (error: unknown) {
				this._debug(`A ClusterClient listener failed with ${error instanceof Error ? error.message : String(error)}.`);
			}
		}
	}
}

export type RefClusterClient = ClusterClient;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessageFromData(value: unknown): string {
	if (isRecord(value) && typeof value.message === 'string') return value.message;
	return 'IPC request failed.';
}

function isErrorResponseType(value: MessageTypes): boolean {
	return value === MessageTypes.ClientEvalResponseError || value === MessageTypes.ClientBroadcastResponseError || value === MessageTypes.ClientManagerEvalResponseError;
}

function heartbeatRequestFromData(value: unknown): { nonce: string; sentAt: number } | undefined {
	if (!isRecord(value) || typeof value.nonce !== 'string' || typeof value.sentAt !== 'number') return undefined;
	return { nonce: value.nonce, sentAt: value.sentAt };
}

function evalRequestFromData(value: unknown): { script: string; options?: EvalOptions } | undefined {
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
	if (typeof value.timeout === 'number' && Number.isFinite(value.timeout)) options.timeout = value.timeout;
	if (typeof value.useAllSettled === 'boolean') options.useAllSettled = value.useAllSettled;

	return options;
}

function numberOrArray(value: unknown): value is number | number[] {
	if (typeof value === 'number') return Number.isFinite(value);
	return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function evalFunction<T>(value: object): ((source: string) => T) | undefined {
	if (!('_eval' in value)) return undefined;
	const callable = value._eval;
	if (typeof callable !== 'function') return undefined;
	return (source) => Reflect.apply(callable, value, [source]);
}

function readyFunctionFor(value: object): (() => boolean) | undefined {
	if (!('isReady' in value)) return undefined;

	const callable = value.isReady;
	if (typeof callable !== 'function') return undefined;

	return () => Reflect.apply(callable, value, []);
}

function readyAtFor(value: object): Date | null | undefined {
	if (!('readyAt' in value)) return undefined;
	return value.readyAt instanceof Date ? value.readyAt : null;
}

function shardMapFor(value: object): Map<number, { status?: number }> | undefined {
	if (!('ws' in value) || !isRecord(value.ws) || !('shards' in value.ws) || !isRecord(value.ws.shards)) return undefined;
	if (value.ws.shards instanceof Map) return value.ws.shards;

	return undefined;
}

async function coreShardStatusesFor(value: object): Promise<Map<number, number> | undefined> {
	if (!('gateway' in value) || !isRecord(value.gateway) || !('fetchStatus' in value.gateway) || typeof value.gateway.fetchStatus !== 'function') return undefined;

	try {
		const result: unknown = await value.gateway.fetchStatus();
		if (!(result instanceof Map)) return undefined;

		const statuses = new Map<number, number>();
		for (const [id, status] of result) {
			if (typeof id === 'number' && typeof status === 'number') statuses.set(id, status);
		}

		return statuses;
	} catch {
		return undefined;
	}
}

function guildFor(value: object, guildId: string): Guild | undefined {
	if (!hasGuildCache(value)) return undefined;

	return value.guilds.cache.get(guildId);
}

function hasGuildCache(value: object): value is { guilds: { cache: { get(id: string): Guild | undefined } } } {
	return 'guilds' in value && isRecord(value.guilds) && 'cache' in value.guilds && isRecord(value.guilds.cache) && 'get' in value.guilds.cache && typeof value.guilds.cache.get === 'function';
}

export declare interface ClusterClient<
	InternalClient extends ClientRefType = ClientRefType,
	InternalManager extends RefClusterManager = RefClusterManager,
> {
	emit<K extends keyof ClusterClientEvents<InternalClient>>(event: K, ...args: ClusterClientEvents<InternalClient>[K]): boolean;
	on<K extends keyof ClusterClientEvents<InternalClient>>(event: K, listener: (...args: ClusterClientEvents<InternalClient>[K]) => void): this;
	once<K extends keyof ClusterClientEvents<InternalClient>>(event: K, listener: (...args: ClusterClientEvents<InternalClient>[K]) => void): this;
	off<K extends keyof ClusterClientEvents<InternalClient>>(event: K, listener: (...args: ClusterClientEvents<InternalClient>[K]) => void): this;
}
