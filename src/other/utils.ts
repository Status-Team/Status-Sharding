import type { ClusterClientData, ClusteringMode } from '../types.js';
import { Worker, workerData } from 'node:worker_threads';
import type { ChildProcess } from 'node:child_process';

function integer(value: unknown, name: string, minimum: number): number {
	const result = Number(value);
	if (!Number.isInteger(result) || result < minimum) throw new Error(`INVALID_CLUSTER_METADATA | ${name} must be an integer >= ${minimum}.`);
	return result;
}

export function getInfo(): ClusterClientData {
	const workerMetadata = isRecord(workerData) ? workerData : undefined;
	const modeValue = stringValue(workerMetadata?.STATUS_CLUSTER_MODE) ?? process.env.STATUS_CLUSTER_MODE;
	const mode: ClusteringMode = modeValue === 'worker' ? 'worker' : 'process';
	
	const source: unknown = mode === 'worker' ? workerMetadata : process.env;
	if (mode !== 'process' && mode !== 'worker') throw new Error('NO_CLUSTER_MANAGER_MODE | Cluster metadata is missing.');

	if (!source || typeof source !== 'object') throw new Error('NO_CLUSTER_MANAGER_MODE | Cluster metadata is missing.');
	const record: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) record[key] = value;

	const shards = Array.isArray(record.STATUS_SHARD_LIST) ? record.STATUS_SHARD_LIST.map(Number) : JSON.parse(String(record.STATUS_SHARD_LIST ?? '[]'));
	if (!Array.isArray(shards) || shards.length === 0) throw new Error('INVALID_CLUSTER_METADATA | No shard IDs were assigned.');

	const totalShards = integer(record.STATUS_TOTAL_SHARDS, 'STATUS_TOTAL_SHARDS', 1);
	const shardList = shards.map((shard) => integer(shard, 'STATUS_SHARD_LIST', 0));
	if (shardList.some((shard) => shard >= totalShards) || new Set(shardList).size !== shardList.length) throw new Error('INVALID_CLUSTER_METADATA | Shard list contains an invalid or duplicate ID.');
	
	const clusterCount = integer(record.STATUS_CLUSTER_COUNT, 'STATUS_CLUSTER_COUNT', 1);
	const clusterId = integer(record.STATUS_CLUSTER_ID, 'STATUS_CLUSTER_ID', 0);
	const queueMode = record.STATUS_QUEUE_MODE === 'manual' ? 'manual' : 'auto';
	const queueUntilReady = record.STATUS_QUEUE_UNTIL_READY === true || record.STATUS_QUEUE_UNTIL_READY === 'true';

	return {
		ShardList: shardList,
		TotalShards: totalShards,
		ClusterCount: clusterCount,
		ClusterId: clusterId,
		ClusterManagerMode: mode,
		ClusterQueueMode: queueMode,
		QueueUntilReady: queueUntilReady,
		IpcTimeout: integer(record.STATUS_IPC_TIMEOUT ?? 30_000, 'STATUS_IPC_TIMEOUT', 1_000),
		IpcMaxPending: integer(record.STATUS_IPC_MAX_PENDING ?? 10_000, 'STATUS_IPC_MAX_PENDING', 1),
		IpcMaxPayload: integer(record.STATUS_IPC_MAX_PAYLOAD ?? 8 * 1024 * 1024, 'STATUS_IPC_MAX_PAYLOAD', 1_024),
		FirstShardId: first(shardList),
		LastShardId: last(shardList),
	};
}

function first<T>(values: T[]): T {
	const value = values[0];
	if (value === undefined) throw new Error('INVALID_CLUSTER_METADATA | No first value exists.');
	return value;
}

function last<T>(values: T[]): T {
	const value = values[values.length - 1];
	if (value === undefined) throw new Error('INVALID_CLUSTER_METADATA | No last value exists.');
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

export function isWorkerThread(value: ChildProcess | Worker): value is Worker {
	return value instanceof Worker;
}

export function isChildProcess(value: ChildProcess | Worker): value is ChildProcess {
	return !isWorkerThread(value);
}
