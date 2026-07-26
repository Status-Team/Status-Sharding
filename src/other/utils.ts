import { Worker as WorkerThread, workerData } from 'worker_threads';
import type { RefShardingCoreClient } from 'src/core/coreClient';
import { ClusterClientData, PackageType } from '../types';
import { ClientRefType } from 'src/core/clusterClient';
import { ChildProcess } from 'child_process';

export function getInfo(): ClusterClientData {
	const clusterMode = process.env.CLUSTER_MANAGER_MODE;
	if (clusterMode !== 'worker' && clusterMode !== 'process') throw new Error('NO_CLUSTER_MANAGER_MODE | ClusterManager Mode is not defined in the environment variables.');

	let data: ClusterClientData;

	if (clusterMode === 'process') {
		const shardList = (process.env.SHARD_LIST || '')
			.replace(/\[|\]/g, '')
			.split(',')
			.map((value) => Number(value.trim()))
			.filter((value) => Number.isInteger(value) && value >= 0);

		data = {
			ShardList: shardList,
			TotalShards: Number(process.env.TOTAL_SHARDS),
			ClusterCount: Number(process.env.CLUSTER_COUNT),
			ClusterId: Number(process.env.CLUSTER),
			ClusterManagerMode: clusterMode,
			ClusterQueueMode: process.env.CLUSTER_QUEUE_MODE as 'auto' | 'manual',
			RespondToHeartbeatWhenNotReady: process.env.RESPOND_TO_HEARTBEAT_WHEN_NOT_READY === 'true',
			FirstShardId: shardList[0] ?? 0,
			LastShardId: shardList[shardList.length - 1] ?? 0,
		};
	} else {
		const shardList = Array.isArray(workerData.SHARD_LIST) ? workerData.SHARD_LIST : [];
		const respondToHeartbeatWhenNotReady = workerData.RESPOND_TO_HEARTBEAT_WHEN_NOT_READY === true
			|| workerData.RESPOND_TO_HEARTBEAT_WHEN_NOT_READY === 'true';

		data = {
			ShardList: shardList,
			TotalShards: workerData.TOTAL_SHARDS,
			ClusterCount: workerData.CLUSTER_COUNT,
			ClusterId: workerData.CLUSTER,
			ClusterManagerMode: clusterMode,
			ClusterQueueMode: workerData.CLUSTER_QUEUE_MODE,
			RespondToHeartbeatWhenNotReady: respondToHeartbeatWhenNotReady,
			FirstShardId: shardList[0] ?? 0,
			LastShardId: shardList[shardList.length - 1] ?? 0,
		};
	}

	return data;
}

export async function getDiscordVersion(type: PackageType) {
	try {
		const { version } = await import(type);
		const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number) as [number, number, number];

		return { major, minor, patch, raw: version };
	} catch (error) {
		throw new Error(`Failed to get version of ${type}: ${(error as Error).message}`, { cause: error });
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function detectLibraryFromClient(client: any): PackageType | null {
	if (!client) return null;

	if (client.constructor?.name === 'Client' && 'guilds' in client && 'users' in client && 'channels' in client && typeof client.login === 'function' && !('api' in client)) {
		return 'discord.js';
	}

	if (client.constructor?.name === 'Client' && 'api' in client && 'rest' in client && 'gateway' in client && typeof client.api === 'object') {
		return '@discordjs/core';
	}

	if (client instanceof Object) {
		if ('guilds' in client && 'users' in client && !('api' in client)) return 'discord.js';
		if ('api' in client || (client.client && 'api' in client.client)) return '@discordjs/core';
	}

	return null;
}

export function isCoreClient(client: ClientRefType): client is RefShardingCoreClient {
	return detectLibraryFromClient(client) === '@discordjs/core';
}

export function isWorkerThread(process: ChildProcess | WorkerThread): process is WorkerThread {
	return 'threadId' in process;
}

export function isChildProcess(process: ChildProcess | WorkerThread): process is ChildProcess {
	return 'pid' in process;
}
