import { Client as DiscordCoreClient, GatewayDispatchEvents, MappedEvents } from '@discordjs/core';
import { CreateWebSocketManagerOptions, WebSocketManager } from '@discordjs/ws';
import { RefClusterManager } from './clusterManager';
import { REST, RESTOptions } from '@discordjs/rest';
import { ClusterClient } from './clusterClient';
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
	public cluster: ClusterClient<this, InternalManager>;
	/* The WebSocket manager of this client. */
	public gateway: WebSocketManager;
	/** The REST manager of this client. */
	public rest: REST;

	/* Shards Ready Count. */
	private shardsReady = 0;

	/** Creates an instance of ShardingCoreClient. */
	constructor (options: ShardingCoreClientOptions) {
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

		this.cluster = new ClusterClient<this, InternalManager>(this);
		this.on(GatewayDispatchEvents.Ready, () => {
			this.shardsReady++;
			if (this.shardsReady === info.ShardList.length) this.cluster.triggerReady();
		});
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
