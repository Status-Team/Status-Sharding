import { ClientEvents, ClientOptions, Client as DiscordClient } from 'discord.js';
import { RefClusterManager } from './clusterManager';
import { ClusterClient } from './clusterClient';
import { getInfo } from '../other/data';

/** Modified ClientEvents such that the ready event has the ShardingClient instead of the normal Client. */
export type ClientEventsModifiable = Omit<ClientEvents, 'ready'> & { ready: [client: ShardingClient] };

/** Modified DiscordClient with bunch of new methods. */
export class ShardingClient<
	Ready extends boolean = boolean,
	InternalManager extends RefClusterManager = RefClusterManager,
> extends DiscordClient<Ready> {
	/** Cluster associated with this client. */
	cluster: ClusterClient<this, InternalManager>;

	/** Creates an instance of ShardingClient. */
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
	/** Emit an event. */
	emit: (<K extends keyof ClientEventsModifiable>(event: K, ...args: ClientEventsModifiable[K]) => boolean) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, ...args: unknown[]) => boolean);
    /** Remove an event listener. */
	off: (<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this);
    /** Listen for an event. */
	on: (<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this);
    /** Listen for an event once. */
	once: (<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void) => this) & (<S extends string | symbol>(event: Exclude<S, keyof ClientEventsModifiable>, listener: (...args: unknown[]) => void) => this);
    /** Remove all listeners for an event. */
	removeAllListeners: (<K extends keyof ClientEventsModifiable>(event?: K) => this) & (<S extends string | symbol>(event?: Exclude<S, keyof ClientEventsModifiable>) => this);
}
