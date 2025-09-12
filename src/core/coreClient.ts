import { CreateWebSocketManagerOptions, WebSocketManager } from '@discordjs/ws';
import { Client as DiscordCoreClient, MappedEvents } from '@discordjs/core';
import { ClusterClient, OnReady } from './clusterClient';
import { RefClusterManager } from './clusterManager';
import { REST, RESTOptions } from '@discordjs/rest';
import { getInfo } from '../other/utils';

export type ShardingCoreClientOptions = {
	gateway: Omit<CreateWebSocketManagerOptions, 'token' | 'rest' | 'shardCount' | 'shardIds'>;
	rest?: Partial<RESTOptions>;
	token: string;
}

/** Modified DiscordClient with bunch of new methods. */
export class ShardingCoreClient<
	InternalManager extends RefClusterManager = RefClusterManager,
> extends DiscordCoreClient {
	/** Cluster associated with this client. */
	cluster: ClusterClient<this, InternalManager>;

	/* The WebSocket manager of this client. */
	gateway: WebSocketManager;
	/** The REST manager of this client. */
	rest: REST;

	/** Creates an instance of ShardingCoreClient. */
	constructor (options: ShardingCoreClientOptions, onReady?: OnReady<ShardingCoreClient> | null) {
		const info = getInfo();

		const rest = new REST(options.rest).setToken(options.token);

		const gateway = new WebSocketManager({
			token: options.token, ...options.gateway,
			shardCount: info.TotalShards,
			shardIds: info.ShardList,
			rest,
		});

		super({ rest, gateway });

		this.rest = rest;
		this.gateway = gateway;

		this.cluster = new ClusterClient<this, InternalManager>(this, onReady || (() => void 0));
	}
}

export type RefShardingCoreClient = ShardingCoreClient;

export declare interface ShardingCoreClient {
	/** Emit an event. */
	emit: (<K extends keyof MappedEvents>(event: K, ...args: MappedEvents[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof MappedEvents>, ...args: unknown[]) => boolean);
	/** Remove an event listener. */
	off: (<K extends keyof MappedEvents>(event: K, listener: (...args: MappedEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof MappedEvents>, listener: (...args: unknown[]) => void) => this);
	/** Listen for an event. */
	on: (<K extends keyof MappedEvents>(event: K, listener: (...args: MappedEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof MappedEvents>, listener: (...args: unknown[]) => void) => this);
	/** Listen for an event once. */
	once: (<K extends keyof MappedEvents>(event: K, listener: (...args: MappedEvents[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof MappedEvents>, listener: (...args: unknown[]) => void) => this);
	/** Remove all listeners for an event. */
	removeAllListeners: (<K extends keyof MappedEvents>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof MappedEvents>) => this);
}
