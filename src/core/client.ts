import { ClientEvents, ClientOptions, Client as DiscordClient } from 'discord.js';
import { RefClusterManager } from './clusterManager';
import { ClusterClient } from './clusterClient';
import { getInfo } from '../other/data';

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
> extends DiscordClient<Ready> {
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
	constructor (options: ClientOptions) {
		super({
			...options,
			shards: getInfo().ShardList,
			shardCount: getInfo().TotalShards,
		});

		this.cluster = new ClusterClient<this, InternalManager>(this);
	}
}

export type RefShardingClient = ShardingClient;

export declare interface ShardingClient {
	/**
	 * Emit an event.
	 * @type {(<K extends keyof ClientEventsModifiable>(event: K, ...args: ClientEventsModifiable[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, ...args: unknown[]) => boolean)}
	 */
	emit: (<K extends keyof ClientEventsModifiable>(event: K, ...args: ClientEventsModifiable[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, ...args: unknown[]) => boolean);
    /**
	 * Remove an event listener.
	 * @type {(<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this)}
	 */
	off: (<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this);
    /**
	 * Listen for an event.
	 * @type {(<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this)}
	 */
	on: (<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this);
    /**
	 * Listen for an event once.
	 * @type {(<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this)}
	 */
	once: (<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this);
    /**
	 * Remove all listeners for an event.
	 * @type {(<K extends keyof ClientEventsModifiable>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClientEventsModifiable>) => this)}
	 */
	removeAllListeners: (<K extends keyof ClientEventsModifiable>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClientEventsModifiable>) => this);
}
