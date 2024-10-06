import { ClientEvents, ClientOptions } from 'discord.js';
import { RefClusterManager } from '../clusterManager';
import { SapphireClient } from '@sapphire/framework';
import { ClusterClient } from '../clusterClient';
import { getInfo } from '../../other/data';

/**
 * Modified ClientEvents such that the ready event has the ShardingClient instead of the normal Client.
 * @export
 * @typedef {ClientEventsModifiable}
 */
type ClientEventsModifiable = Omit<ClientEvents, 'ready'> & { ready: [client: ShardingClientSapphire] };

/**
 * Modified DiscordClient with bunch of new methods.
 * @export
 * @class ShardingClient
 * @typedef {ShardingClient}
 * @template {boolean} [Ready=boolean] - The ready state of the client.
 * @template {RefClusterManager} [InternalManager=RefClusterManager] - The manager to use for the client.
 * @extends {DiscordClient}
 */
export class ShardingClientSapphire<
	Ready extends boolean = boolean,
	InternalManager extends RefClusterManager = RefClusterManager,
> extends SapphireClient<Ready> {
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

	// Events.
	on<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	on<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
	on(event: symbol, listener: (...args: unknown[]) => void): this {
		return super.on(event, listener);
	}

	once<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	once<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
	once(event: symbol, listener: (...args: unknown[]) => void): this {
		return super.once(event, listener);
	}

	off<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	off<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void): this;
	off(event: symbol, listener: (...args: unknown[]) => void): this {
		return super.off(event, listener);
	}

	emit<K extends keyof ClientEventsModifiable>(event: K, ...args: ClientEventsModifiable[K]): boolean;
	emit<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, ...args: unknown[]): boolean;
	emit(event: symbol, ...args: unknown[]): boolean {
		return super.emit(event, ...args);
	}
}
