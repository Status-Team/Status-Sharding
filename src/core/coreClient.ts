import type { CreateWebSocketManagerOptions, WebSocketManager } from '@discordjs/ws';
import type { REST, RESTOptions } from '@discordjs/rest';
import type { RefClusterManager } from '../types.js';
import type { MappedEvents } from '@discordjs/core';
import { ClusterClient } from './clusterClient.js';
import { getInfo } from '../other/utils.js';
import { createRequire } from 'node:module';

type DynamicConstructor<T> = new (options: unknown) => T;

interface CoreClientShape {
	on(event: string | symbol, listener: (...args: unknown[]) => unknown): this;
}

interface CoreModule {
	Client: DynamicConstructor<CoreClientShape>;
	GatewayDispatchEvents?: { Ready?: string };
}

interface RestModule {
	REST: DynamicConstructor<REST>;
}

interface SocketModule {
	WebSocketManager: DynamicConstructor<WebSocketManager>;
}

class MissingCoreClient implements CoreClientShape {
	public on(): this {
		return this;
	}
}

const loadModule = createRequire(typeof __filename === 'string' ? __filename : `${process.cwd()}/package.json`);
let CoreClient: DynamicConstructor<CoreClientShape> = MissingCoreClient;
let RestClient: DynamicConstructor<REST> | undefined;
let SocketManager: DynamicConstructor<WebSocketManager> | undefined;
let readyDispatchEvent = 'READY';

try {
	const core: unknown = loadModule('@discordjs/core');
	const rest: unknown = loadModule('@discordjs/rest');
	const ws: unknown = loadModule('@discordjs/ws');

	if (isCoreModule(core) && isRestModule(rest) && isSocketModule(ws)) {
		CoreClient = core.Client;
		RestClient = rest.REST;
		SocketManager = ws.WebSocketManager;
		if (core.GatewayDispatchEvents && typeof core.GatewayDispatchEvents.Ready === 'string') readyDispatchEvent = core.GatewayDispatchEvents.Ready;
	}
} catch {
	CoreClient = MissingCoreClient;
	RestClient = undefined;
	SocketManager = undefined;
}

export interface ShardingCoreClientOptions {
	token: string;
	gateway: Omit<CreateWebSocketManagerOptions, 'token' | 'rest' | 'shardCount' | 'shardIds'>;
	rest?: Partial<RESTOptions>;
}

export class ShardingCoreClient<InternalManager extends RefClusterManager = RefClusterManager> extends CoreClient {
	public readonly cluster: ClusterClient<this, InternalManager>;
	public readonly gateway: WebSocketManager;
	public readonly rest: REST;

	private readonly readyShards = new Set<number>();

	constructor (options: ShardingCoreClientOptions) {
		const info = getInfo();
		if (!RestClient || !SocketManager) throw new Error('CORE_DEPENDENCIES_MISSING | Install @discordjs/core, @discordjs/rest, and @discordjs/ws to use ShardingCoreClient.');

		const rest = new RestClient(options.rest).setToken(options.token);
		const gateway = new SocketManager({
			token: options.token,
			...options.gateway,
			shardCount: info.TotalShards,
			shardIds: info.ShardList,
			rest,
		});

		super({ rest, gateway });

		this.rest = rest;
		this.gateway = gateway;
		this.cluster = new ClusterClient<this, InternalManager>(this);

		this.on(readyDispatchEvent, (event: unknown) => {
			const shardId = shardIdFromEvent(event);
			if (shardId === undefined || !info.ShardList.includes(shardId)) return;

			this.readyShards.add(shardId);
			if (this.readyShards.size === info.ShardList.length) void this.cluster._applyHealthState(true);
		});
	}
}

export declare interface ShardingCoreClient<InternalManager extends RefClusterManager = RefClusterManager> {
	on<K extends keyof MappedEvents>(event: K, listener: (...args: MappedEvents[K]) => void): this;
	on(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCoreModule(value: unknown): value is CoreModule {
	if (!isRecord(value) || typeof value.Client !== 'function') return false;
	return true;
}

function isRestModule(value: unknown): value is RestModule {
	return isRecord(value) && typeof value.REST === 'function';
}

function isSocketModule(value: unknown): value is SocketModule {
	return isRecord(value) && typeof value.WebSocketManager === 'function';
}

function shardIdFromEvent(value: unknown): number | undefined {
	if (!isRecord(value) || typeof value.shardId !== 'number' || !Number.isInteger(value.shardId)) return undefined;
	return value.shardId;
}
