import { CreateWebSocketManagerOptions, WebSocketManager } from '@discordjs/ws';
import { Client as DiscordCoreClient } from '@discordjs/core';
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
	cluster: ClusterClient<this, InternalManager>;

	/* The WebSocket manager of this client. */
	gateway: WebSocketManager;
	/** The REST manager of this client. */
	rest: REST;

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
	}
}

export type RefShardingCoreClient = ShardingCoreClient;
