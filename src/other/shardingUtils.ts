import { DeconstructedFunction, DefaultOptions, Endpoints, RecursiveStringArray, ValidIfSerializable } from '../types';

/**
 * All possible characters for nonce generation.
 * @type {"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"}
 */
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Sharding utils.
 * @export
 * @class ShardingUtils
 * @typedef {ShardingUtils}
 */
export class ShardingUtils {
	/**
	 * Generates a nonce.
	 * @returns {string} The nonce.
	 */
	public static generateNonce(): string {
		let randomStr = '';

		do {
			randomStr += characters.charAt(Math.floor(Math.random() * characters.length));
		} while (randomStr.length < 10);

		return randomStr;
	}

	/**
	 * Chunks an array into smaller arrays.
	 * @template {unknown} T - The type of the array.
	 * @param {T[]} array - The array to chunk.
	 * @param {number} chunkSize - The size of the chunks.
	 * @param {boolean} [equalize=false] - Whether to equalize items per chunk or to fill them up and last one possibly being smaller.
	 * @returns {T[][]} The chunked array.
	 */
	public static chunkArray<T>(array: T[], chunkSize: number, equalize = false): T[][] {
		const R = [] as T[][];

		if (equalize) chunkSize = Math.ceil(array.length / (Math.ceil(array.length / chunkSize)));

		for (let i = 0; i < array.length; i += chunkSize) {
			R.push(array.slice(i, i + chunkSize));
		}

		return R;
	}

	/**
	 * Delays for a certain amount of time.
	 * @param {number} ms - The amount of time to delay for.
	 * @returns {Promise<void>} Nothing.
	 */
	public static delayFor(ms: number): Promise<void> {
		return new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	/**
	 * Checks if a value is serializable.
	 * @template {unknown} T - The type of the value.
	 * @param {T} value - The value to check.
	 * @returns {(value is T & ValidIfSerializable<T>)} Whether the value is serializable.
	 */
	public static isSerializable<T>(value: T): value is T & ValidIfSerializable<T> {
		if (typeof value === 'object' && value !== null && value.constructor !== Object && value.constructor !== Array) return false;
		else if (typeof value === 'function') return false;
		else if (typeof value === 'symbol') return false;

		return true;
	}

	/**
	 * Removes all non-existing values from an array.
	 * @template {unknown} T - The type of the array.
	 * @param {(T | undefined)[]} array - The array to remove the non-existing values from.
	 * @returns {(T[] | undefined)} The array without the non-existing values.
	 */
	public static removeNonExisting<T>(array: (T | undefined)[]): T[] | undefined {
		return array.reduce((acc: T[], item: T | undefined) => {
			if (item !== undefined && item !== null) acc.push(item);
			return acc;
		}, []);
	}

	/**
	 * Makes an error plain.
	 * @param {Error} err - The error to make plain.
	 * @returns {{ name: string; message: string; stack: string; }} The plain error.
	 */
	public static makePlainError(err: Error): { name: string; message: string; stack: string; } {
		const removeStuff = <T extends string>(v: T) => v.replace(/(\n|\r|\t)/g, '').replace(/( )+/g, ' ').replace(/(\/\/.*)/g, '');

		return {
			name: removeStuff(err.name),
			message: removeStuff(err.message),
			stack: removeStuff(err.stack?.replace(': ' + err.message, '') || ''),
		};
	}

	/**
	 * Merges two objects.
	 * @template {object} T - The type of the objects.
	 * @param {Partial<T>} main - The main object.
	 * @param {Partial<T>} toMerge - The object to merge.
	 * @returns {T} The merged object.
	 */
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
	/**
	 * Gets the shard id for a guild id.
	 * @param {string} guildId - The guild id to get the shard id for.
	 * @param {number} totalShards - The total amount of shards.
	 * @returns {number} The shard id.
	 */
	public static shardIdForGuildId(guildId: string, totalShards: number): number {
		if (!guildId?.match(/^[0-9]+$/)) throw new Error('No valid GuildId Provided (#1).');
		else if (isNaN(totalShards) || totalShards < 1) throw new Error('No valid TotalShards Provided (#1).');

		const shard = Number(BigInt(guildId) >> BigInt(22)) % totalShards;
		if (shard < 0) throw new Error('SHARD_MISCALCULATION_SHARDID_SMALLER_THAN_0 ' + `Calculated Shard: ${shard}, guildId: ${guildId}, totalShards: ${totalShards}`);

		return shard;
	}

	/**
	 * Gets the cluster id for a shard id.
	 * @param {string} shardId - The shard id to get the cluster id for.
	 * @param {number} totalShards - The total amount of shards.
	 * @param {number} totalClusters - The total amount of clusters.
	 * @returns {number} The cluster id.
	 */
	public static clusterIdForShardId(shardId: string, totalShards: number, totalClusters: number): number {
		if (!shardId?.match(/^[0-9]+$/)) throw new Error('No valid Shard Id Provided.');
		else if (isNaN(totalShards) || totalShards < 1) throw new Error('No valid TotalShards Provided (#2).');
		else if (isNaN(totalClusters) || totalClusters < 1) throw new Error('No valid TotalClusters Provided (#1).');

		const middlePart = Number(shardId) === 0 ? 0 : Number(shardId) / Math.ceil(totalShards / totalClusters);
		return Number(shardId) === 0 ? 0 : (Math.ceil(middlePart) - (middlePart % 1 !== 0 ? 1 : 0));
	}

	/**
	 * Gets the cluster id for a guild id.
	 * @param {string} guildId - The guild id to get the cluster id for.
	 * @param {number} totalShards - The total amount of shards.
	 * @param {number} totalClusters - The total amount of clusters.
	 * @returns {number} The cluster id.
	 */
	public static clusterIdForGuildId(guildId: string, totalShards: number, totalClusters: number): number {
		if (!guildId?.match(/^[0-9]+$/)) throw new Error('No valid GuildId Provided (#2).');
		else if (isNaN(totalShards) || totalShards < 1) throw new Error('No valid TotalShards Provided (#3).');
		else if (isNaN(totalClusters) || totalClusters < 1) throw new Error('No valid TotalClusters Provided (#2).');

		const shardId = this.shardIdForGuildId(guildId, totalShards);
		return this.clusterIdForShardId(shardId.toString(), totalShards, totalClusters);
	}

	/**
	 * Gets the cluster id for a shard id.
	 * @async
	 * @param {string} token - The token to use.
	 * @param {number} [guildsPerShard=1000] - The amount of guilds per shard.
	 * @returns {Promise<number>} The recommended amount of shards.
	 */
	public static async getRecommendedShards(token: string, guildsPerShard: number = 1000): Promise<number> {
		if (!token) throw new Error('DISCORD_TOKEN_MISSING | No token was provided to ClusterManager options.');

		const response = await fetch(`${DefaultOptions.http.api}/v${DefaultOptions.http.version}${Endpoints.botGateway}`, {
			method: 'GET',
			headers: { Authorization: `Bot ${token.replace(/^Bot\s*/i, '')}` },
		}).then((res) => {
			if (res.ok) return res.json() as Promise<{ shards: number }>;
			else if (res.status === 401) throw new Error('DISCORD_TOKEN_INVALID | The provided token was invalid.');

			throw res;
		});

		return response.shards * (1000 / guildsPerShard);
	}

	/**
	 * Parses a function to a string.
	 * @template {unknown} R - The return type of the function.
	 * @template {never[]} A - The arguments of the function.
	 * @param {(string | ((...args: A) => R))} func - The function to parse.
	 * @returns {string} The parsed function.
	 */
	public static guildEvalParser<R, A extends never[]>(func: string | ((...args: A) => R)): string {
		if (typeof func === 'function') func = func.toString();

		const type: 'function' | 'arrow' = (func.startsWith('function') || func.startsWith('async function')) ? 'function' : 'arrow';
		if (type === 'function') func = func.replace(/function\s+\w+\s*/, 'function ');

		const data = getStuff({ func, type });
		return reconstruct({ ...data, ...insertBodyCheck(data) });

		function getStuff({ func, type }: { func: string, type: 'function' | 'arrow' }) {
			switch (type) {
				case 'arrow': {
					let [wrapScope, wrapArgs, isAsync] = [false, false, false];

					func = func.startsWith('async') ? func.replace(/async\s*/, () => { isAsync = true; return ''; }) : func;

					const stuff = func.split('=>').map((x) => x.trim());
					const body = stuff.slice(1);
					let args = stuff[0];

					let actualBody = body.join(' => ').trim();

					if (args.startsWith('(')) { args = args.slice(1, -1); wrapArgs = true; }
					if (actualBody.match(/^\{[\s\S]*\}$/)) {
						wrapScope = false;
						actualBody = actualBody.slice(1, -1).trim();
						if (actualBody.endsWith(';')) actualBody = actualBody.slice(0, -1).trim();
					}
					return {
						args: args.split(',').map((x) => {
							x = x.trim();
							if (x.includes('{')) {
								const destructured = x.slice(x.indexOf('{') + 1, x.indexOf('}')).split(',').map((x) => x.trim().split(' ').pop() || '').filter((x) => x);
								return destructured.length ? destructured : x;
							} else return x.split(' ').pop() || '';

						}).filter((x) => x),
						body: actualBody.trim(),
						isAsync,
						wrapScope,
						wrapArgs,
					};
				}
				case 'function': {
					let [wrapScope, isAsync] = [true, false];

					func = func.startsWith('async') ? func.replace(/async\s*/, () => { isAsync = true; return ''; }) : func;

					const stuff = func.split(') {').map((x, i) => { x = x.trim(); return i === 0 ? x.slice(x.indexOf('(') + 1) : `{ ${x}`; });
					const body = stuff.slice(1);
					let args = stuff[0];

					let actualBody = body.join(') {').trim();

					if (args.startsWith('(')) { args = args.slice(1, -1); }
					if (actualBody.match(/^\{[\s\S]*\}$/)) {
						wrapScope = false;
						actualBody = actualBody.slice(1, -1).trim();
						if (actualBody.endsWith(';')) actualBody = actualBody.slice(0, -1).trim();
					}

					return {
						args: args.split(',').map((x) => {
							x = x.trim();
							if (x.includes('{')) {
								const destructured = x.slice(x.indexOf('{') + 1, x.indexOf('}')).split(',').map((x) => x.trim().split(' ').pop() || '').filter((x) => x);
								return destructured.length ? destructured : x;
							} else return x.split(' ').pop() || '';

						}).filter((x) => x),
						body: actualBody.trim(),
						wrapScope,
						wrapArgs: true,
						isAsync,
					};
				}
			}
		}

		function reconstruct({ args, body, wrapScope, wrapArgs, isAsync }: DeconstructedFunction) {
			let argsStr = makeArgs(args);

			switch (type) {
				case 'arrow': {
					if (wrapArgs) argsStr = `(${argsStr})`;
					if (wrapScope) body = `{ ${body} }`;
					if (isAsync) argsStr = `async ${argsStr}`;

					return `${argsStr} => ${body}`;
				}
				case 'function': {
					if (wrapArgs) argsStr = `(${argsStr})`;
					if (wrapScope) body = `{ ${body} }`;
					return `function ${argsStr} ${body}`;
				}
			}
		}

		function makeArgs(args: RecursiveStringArray): string {
			return args.map((x) => {
				if (typeof x === 'string') return x;
				else return `{ ${makeArgs(x)} }`;
			}).join(', ');
		}

		function insertBodyCheck({ args, body, wrapScope }: Omit<DeconstructedFunction, 'wrapArgs'>) {
			if (args.length < 3) return { body: body };

			return {
				wrapScope: true,
				body: !body.match(new RegExp(`if\\s*\\(\\s*!\\s*${args[2]}\\s*\\)\\s*return`, 'g'))
					? `if (!${args[2]}) return;\n ${wrapScope ? body : `return ${body};`}`
					: body,
			};
		}
	}
}
