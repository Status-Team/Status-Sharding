import { DefaultOptions, Endpoints, PackageType, ValidIfSerializable } from '../types';
import { randomBytes } from 'crypto';

/** Sharding utils. */
export class ShardingUtils {
	/** Generates a nonce. */
	public static generateNonce(): string {
		return randomBytes(10).toString('hex');
	}

	/** Chunks an array into smaller arrays. */
	public static chunkArray<T>(array: T[], chunkSize: number, equalize = false): T[][] {
		const R = [] as T[][];

		if (equalize) chunkSize = Math.ceil(array.length / (Math.ceil(array.length / chunkSize)));

		for (let i = 0; i < array.length; i += chunkSize) {
			R.push(array.slice(i, i + chunkSize));
		}

		return R;
	}

	/** Delays for a certain amount of time. */
	public static delayFor(ms: number): Promise<void> {
		return new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	/** Checks if a value is serializable. */
	public static isSerializable<T>(value: T): value is T & ValidIfSerializable<T> {
		if (typeof value === 'object' && value !== null && value.constructor !== Object && value.constructor !== Array) return false;
		else if (typeof value === 'function') return false;
		else if (typeof value === 'symbol') return false;

		return true;
	}

	/** Removes all non-existing values from an array. */
	public static removeNonExisting<T>(array: (T | undefined)[]): T[] | undefined {
		return array.reduce((acc: T[], item: T | undefined) => {
			if (item !== undefined && item !== null) acc.push(item);
			return acc;
		}, []);
	}

	/** Makes an error plain. */
	public static makePlainError(err: Error): { name: string; message: string; stack: string; } {
		const removeStuff = <T extends string>(v: T) => v.replace(/(\n|\r|\t)/g, '').replace(/( )+/g, ' ').replace(/(\/\/.*)/g, '');

		return {
			name: removeStuff(err.name),
			message: removeStuff(err.message),
			stack: removeStuff(err.stack?.replace(': ' + err.message, '') || ''),
		};
	}

	/** Merges two objects. */
	public static mergeObjects<T extends object>(main: Partial<T>, toMerge: Partial<T>): T {
		const merged: Partial<T> = { ...toMerge };

		for (const key in main) {
			if (Object.prototype.hasOwnProperty.call(main, key)) {
				if (typeof main[key] === 'object' && !Array.isArray(main[key])) {
					merged[key] = ShardingUtils.mergeObjects(toMerge[key] ?? {}, main[key] ?? {}) as T[Extract<keyof T, string>];
				} else {
					merged[key] = main[key];
				}
			}
		}

		return merged as T;
	}
	/** Gets the shard id for a guild id. */
	public static shardIdForGuildId(guildId: string, totalShards: number): number {
		if (!guildId?.match(/^[0-9]+$/)) throw new Error('No valid GuildId Provided (#1).');
		else if (isNaN(totalShards) || totalShards < 1) throw new Error('No valid TotalShards Provided (#1).');

		const shard = Number(BigInt(guildId) >> BigInt(22)) % totalShards;
		if (shard < 0) throw new Error('SHARD_MISCALCULATION_SHARDID_SMALLER_THAN_0 ' + `Calculated Shard: ${shard}, guildId: ${guildId}, totalShards: ${totalShards}`);

		return shard;
	}

	/** Gets the cluster id for a shard id. */
	public static clusterIdForShardId(shardId: string, totalShards: number, totalClusters: number): number {
		if (!shardId?.match(/^[0-9]+$/)) throw new Error('No valid Shard Id Provided.');
		else if (isNaN(totalShards) || totalShards < 1) throw new Error('No valid TotalShards Provided (#2).');
		else if (isNaN(totalClusters) || totalClusters < 1) throw new Error('No valid TotalClusters Provided (#1).');

		const middlePart = Number(shardId) === 0 ? 0 : Number(shardId) / Math.ceil(totalShards / totalClusters);
		return Number(shardId) === 0 ? 0 : (Math.ceil(middlePart) - (middlePart % 1 !== 0 ? 1 : 0));
	}

	/** Gets the cluster id for a guild id. */
	public static clusterIdForGuildId(guildId: string, totalShards: number, totalClusters: number): number {
		if (!guildId?.match(/^[0-9]+$/)) throw new Error('No valid GuildId Provided (#2).');
		else if (isNaN(totalShards) || totalShards < 1) throw new Error('No valid TotalShards Provided (#3).');
		else if (isNaN(totalClusters) || totalClusters < 1) throw new Error('No valid TotalClusters Provided (#2).');

		const shardId = this.shardIdForGuildId(guildId, totalShards);
		return this.clusterIdForShardId(shardId.toString(), totalShards, totalClusters);
	}

	/** Gets the cluster id for a shard id. */
	public static async getRecommendedShards(token: string, guildsPerShard: number = 1000, options = DefaultOptions): Promise<number> {
		if (!token) throw new Error('DISCORD_TOKEN_MISSING | No token was provided to ClusterManager options.');

		const response = await fetch(`${options.http.api}/v${options.http.version}${Endpoints.botGateway}`, {
			method: 'GET',
			headers: { Authorization: `Bot ${token.replace(/^Bot\s*/i, '')}` },
		}).then((res) => {
			if (res.ok) return res.json() as Promise<{ shards: number }>;
			else if (res.status === 401) throw new Error('DISCORD_TOKEN_INVALID | The provided token was invalid.');

			throw res;
		});

		return response.shards * (1000 / guildsPerShard);
	}

	public static parseInput<T>(input: string | T, context?: unknown, packageType?: PackageType | null, ...args: string[]): string {
		if (typeof input === 'string') return input;
		else if (typeof input === 'function') {
			if (packageType === '@discordjs/core') return `(${input.toString()})(client,${context ? JSON.stringify(context) : undefined}${args.length ? ',' + args.join(',') : ''})`;
			return `(${input.toString()})(this,${context ? JSON.stringify(context) : undefined}${args.length ? ',' + args.join(',') : ''})`;
		}

		throw new Error('INVALID_INPUT_TYPE | The input provided was not a string or a function.');
	}

	public static boolProp<T extends string>(input: unknown, key: T): T | `not ${T}` {
		return input ? key : `not ${key}` as T | `not ${T}`;
	}

	public static relativeTime(time?: number): string {
		if (!time) return 'never';

		const date = new Date(time);
		const now = new Date();

		const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (seconds < 60) return `${seconds} seconds ago`;
		else if (minutes < 60) return `${minutes} minutes ago`;
		else if (hours < 24) return `${hours} hours ago`;
		else return `${days} days ago`;
	}
}
