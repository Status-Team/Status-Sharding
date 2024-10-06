import { ClientEvents, ClientOptions, Client } from 'discord.js';
import { RefClusterManager } from '../clusterManager';
import { ClusterClient } from '../clusterClient';
import { getInfo } from '../../other/data';

/**
 * Modified ClientEvents such that the ready event has the ShardingClient instead of the normal Client.
 * @export
 * @typedef {ClientEventsModifiable}
 */
export type ClientEventsModifiable = Omit<ClientEvents, 'ready'> & { ready: [client: ShardingClient] };

/**
 * Modified DiscordClient with bunch of new methods.
 * @export
 * @class ShardingClient
 * @typedef {ShardingClient}
 * @template {boolean} [Ready=boolean] - The ready state of the client.
 * @template {RefClusterManager} [InternalManager=RefClusterManager] - The manager to use for the client.
 * @extends {DiscordClient}
 */
export class ShardingClient<
	Ready extends boolean = boolean,
	InternalManager extends RefClusterManager = RefClusterManager,
> extends Client<Ready> {
	/**
	 * Cluster associated with this client.
	 * @type {ClusterClient<this, InternalManage>}
	 */
	cluster: ClusterClient<this, InternalManager>;

	/**
	 * Creates an instance of ShardingClient.
	 * @constructor
	 * @param {ClientOptions} options - The options for the client.
	 */
	constructor(options: ClientOptions) {
		super({
			...options,
			shards: getInfo().ShardList,
			shardCount: getInfo().TotalShards,
		});

		this.cluster = new ClusterClient<this, InternalManager>(this);
	}
}
