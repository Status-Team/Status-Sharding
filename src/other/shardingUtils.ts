import type { GatewayBotInfo, PackageType, Serializable } from '../types.js';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';

export const MAX_TIMER_DELAY = 2_147_483_647;

export class ShardingUtils {
	public static monotonicNow(): number {
		return performance.now();
	}

	public static generateNonce(): string {
		return randomBytes(16).toString('hex');
	}

	public static async delayFor(milliseconds: number): Promise<void> {
		if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('TIMER_DELAY_INVALID | Delay must be non-negative.');

		let remaining = milliseconds;
		while (remaining > MAX_TIMER_DELAY) {
			await new Promise<void>((resolve) => setTimeout(resolve, MAX_TIMER_DELAY));
			remaining -= MAX_TIMER_DELAY;
		}

		await new Promise<void>((resolve) => setTimeout(resolve, remaining));
	}

	public static validateTimerDelay(value: number, name: string, minimum = 0): number {
		if (!Number.isFinite(value) || value < minimum || value > MAX_TIMER_DELAY) throw new RangeError(`${name} must be between ${minimum} and ${MAX_TIMER_DELAY} milliseconds.`);
		return value;
	}

	public static chunkArray<T>(values: readonly T[], chunkSize: number): T[][] {
		if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new RangeError('CHUNK_SIZE_INVALID | Chunk size must be a positive integer.');

		const chunks: T[][] = [];
		for (let index = 0; index < values.length; index += chunkSize) chunks.push(values.slice(index, index + chunkSize));

		return chunks;
	}

	public static shardIdForGuildId(guildId: string, totalShards: number): number {
		if (!/^\d+$/.test(guildId) || !Number.isInteger(totalShards) || totalShards < 1) throw new TypeError('GUILD_SHARD_INPUT_INVALID | Guild ID and total shard count are invalid.');
		return Number((BigInt(guildId) >> 22n) % BigInt(totalShards));
	}

	public static clusterIdForShardId(shardId: number, totalShards: number, totalClusters: number): number {
		if (!Number.isInteger(shardId) || shardId < 0 || shardId >= totalShards) throw new RangeError('SHARD_ID_INVALID | Shard ID is outside the configured topology.');
		if (!Number.isInteger(totalShards) || totalShards < 1 || !Number.isInteger(totalClusters) || totalClusters < 1) throw new RangeError('TOPOLOGY_INVALID | Shard and cluster counts must be positive integers.');

		return Math.min(totalClusters - 1, Math.floor(shardId / Math.ceil(totalShards / totalClusters)));
	}

	public static clusterIdForGuildId(guildId: string, totalShards: number, totalClusters: number): number {
		return this.clusterIdForShardId(this.shardIdForGuildId(guildId, totalShards), totalShards, totalClusters);
	}

	public static isSerializable(value: unknown): value is Serializable {
		const seen = new Set<object>();

		const visit = (candidate: unknown): boolean => {
			if (candidate === null || candidate === undefined || typeof candidate === 'string' || typeof candidate === 'boolean') return true;
			if (typeof candidate === 'number') return Number.isFinite(candidate);
			if (typeof candidate !== 'object' || seen.has(candidate)) return false;
			seen.add(candidate);

			if (Array.isArray(candidate)) return candidate.every(visit);
			if (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null) return false;
			return Object.values(candidate).every(visit);
		};

		return visit(value);
	}

	public static removeNonExisting<T>(array: Array<T | undefined>): T[] | undefined {
		const values: T[] = [];

		for (const item of array) {
			if (item !== undefined && item !== null) values.push(item);
		}

		return values;
	}

	public static parseInput<T>(input: string | ((...args: unknown[]) => T), context?: unknown, packageType?: PackageType | null, ...argumentsList: string[]): string {
		if (typeof input === 'string') return input;
		const receiver = packageType === '@discordjs/core' ? 'client' : 'this';
		const contextSource = context === undefined ? 'undefined' : JSON.stringify(context);
		return `(${input.toString()})(${receiver},${contextSource}${argumentsList.length ? `,${argumentsList.join(',')}` : ''})`;
	}

	public static async getGatewayBotInfo(token: string, api = 'https://discord.com/api', timeout = 10_000): Promise<GatewayBotInfo> {
		if (!token?.trim()) throw new Error('DISCORD_TOKEN_MISSING | A bot token is required when shard counts are automatic.');
		const response = await fetch(`${api}/v10/gateway/bot`, {
			headers: { Authorization: `Bot ${token.replace(/^Bot\s+/i, '')}` },
			signal: AbortSignal.timeout(timeout),
		});

		if (response.status === 401) throw new Error('DISCORD_TOKEN_INVALID | Discord rejected the bot token.');
		if (!response.ok) throw new Error(`DISCORD_GATEWAY_BOT_FAILED | Discord returned HTTP ${response.status}.`);
		
		const body = await response.json();
		if (!isRecord(body)) throw new Error('DISCORD_GATEWAY_BOT_INVALID | Discord returned incomplete gateway metadata.');

		const limit = body.session_start_limit;
		if (typeof body.url !== 'string' || !Number.isInteger(body.shards) || Number(body.shards) < 1 || !isRecord(limit) || !Number.isInteger(limit.total) || !Number.isInteger(limit.remaining) || !Number.isFinite(limit.reset_after) || !Number.isInteger(limit.max_concurrency)) throw new Error('DISCORD_GATEWAY_BOT_INVALID | Discord returned incomplete gateway metadata.');
		
		return {
			url: body.url,
			shards: Number(body.shards),
			sessionStartLimit: {
				total: Number(limit.total),
				remaining: Number(limit.remaining),
				resetAfter: Number(limit.reset_after),
				maxConcurrency: Number(limit.max_concurrency),
			},
		};
	}

	public static makePlainError(error: unknown): { name: string; message: string; stack?: string } {
		const normalized = error instanceof Error ? error : new Error(String(error));
		return {
			name: normalized.name.slice(0, 128),
			message: normalized.message.slice(0, 4_096),
			stack: normalized.stack?.slice(0, 8_192),
		};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
