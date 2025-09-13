import { ClientEvents, ClientOptions, Client as DiscordClient } from 'discord.js';
import { getDiscordVersion, getInfo } from '../other/utils';
import { RefClusterManager } from './clusterManager';
import { ClusterClient } from './clusterClient';

/** Modified ClientEvents such that the ready event has the ShardingClient instead of the normal Client. */
export type ClientEventsModifiable = Omit<ClientEvents, 'ready' | 'clientReady'> & {
	ready: [client: ShardingClient];
	clientReady: [client: ShardingClient];
};

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
		this.shardsReady();
	}

	private async shardsReady() {
		const { major, minor, patch } = await getDiscordVersion('discord.js');
		const useClientReady = major > 14 || (major === 14 && (minor > 22 || (minor === 22 && patch >= 0)));

		this.on(useClientReady ? 'clientReady' : 'ready', () => this.cluster.triggerReady());
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
