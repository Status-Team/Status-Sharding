import { Client, type ClientEvents, type ClientOptions } from 'discord.js';
import type { RefClusterManager } from '../types.js';
import { ClusterClient } from './clusterClient.js';
import { getInfo } from '../other/utils.js';

export type ClientEventsModifiable = Omit<ClientEvents, 'ready' | 'clientReady'> & {
	ready: [client: ShardingClient];
	clientReady: [client: ShardingClient];
};

export type ShardingClientOptions = ClientOptions;

export class ShardingClient<
	Ready extends boolean = boolean,
	InternalManager extends RefClusterManager = RefClusterManager,
> extends Client<Ready> {
	public readonly cluster: ClusterClient<this, InternalManager>;

	constructor (options: ShardingClientOptions) {
		const info = getInfo();

		super({ ...options, shards: info.ShardList, shardCount: info.TotalShards });
		this.cluster = new ClusterClient<this, InternalManager>(this);

		const synchronize = () => void this.synchronizeHealth();
		const unready = () => void this.cluster._applyHealthState(false).catch((error: unknown) => {
			this.cluster._debug(`Health synchronization failed with ${error instanceof Error ? error.message : String(error)}.`)
		});

		this.on('clientReady', synchronize);
		this.on('shardReady', synchronize);
		this.on('shardResume', synchronize);
		this.on('shardDisconnect', unready);
		this.on('shardReconnecting', unready);
	}

	private async synchronizeHealth(): Promise<void> {
		try {
			await this.cluster._applyHealthState(await this.cluster.isReadyForHeartbeatAck());
		} catch (error: unknown) {
			this.cluster._debug(`Health synchronization failed with ${error instanceof Error ? error.message : String(error)}.`);
		}
	}
}

export declare interface ShardingClient<Ready extends boolean = boolean, InternalManager extends RefClusterManager = RefClusterManager> {
	on<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	once<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	off<K extends keyof ClientEventsModifiable>(event: K, listener: (...args: ClientEventsModifiable[K]) => void): this;
	emit<K extends keyof ClientEventsModifiable>(event: K, ...args: ClientEventsModifiable[K]): boolean;
}
