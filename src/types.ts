import type { ChildProcess, ForkOptions } from 'node:child_process';
import type { Worker, WorkerOptions } from 'node:worker_threads';
import type { ProcessMessage } from './other/message.js';

/* ----------------------------------- Core ----------------------------------- */

export type ClusteringMode = 'process' | 'worker';
export type PackageType = 'discord.js' | '@discordjs/core';
export type Awaitable<T> = T | PromiseLike<T>;

export enum MessageTypes {
	MissingType = 0,
	CustomRequest = 1,
	CustomMessage = 2,
	CustomReply = 3,
	Heartbeat = 4,
	HeartbeatAck = 5,
	ClientBroadcast = 6,
	ClientBroadcastRequest = 7,
	ClientBroadcastResponse = 8,
	ClientBroadcastResponseError = 9,
	ClientRespawn = 10,
	ClientRespawnAll = 11,
	ClientSpawnNextCluster = 16,
	ClientReady = 17,
	ClientEvalRequest = 18,
	ClientEvalResponse = 19,
	ClientEvalResponseError = 20,
	ClientManagerEvalRequest = 21,
	ClientManagerEvalResponse = 22,
	ClientManagerEvalResponseError = 23,
	ManagerReady = 24,
	Kill = 25,
	ClientRespawnSpecific = 26,
	ClientUnready = 27,
	BrokerMessage = 28,
}

export type Serializable = string | number | boolean | null | undefined | Serializable[] | { [key: string]: Serializable };

export type SerializableInput<T> = T extends Serializable ? T : Serializable;

export type Serialized<T> = T;

export type ValidIfSerializable<T> = Serialized<T>;

/* ----------------------------------- Gateway ----------------------------------- */

export interface GatewaySessionStartLimit {
	total: number;
	remaining: number;
	resetAfter: number;
	maxConcurrency: number;
}

export interface GatewayBotInfo {
	url: string;
	shards: number;
	sessionStartLimit: GatewaySessionStartLimit;
}

export interface ClusterHeartbeatOptions {
	enabled?: boolean;
	interval?: number;
	timeout?: number;
	maxMissedHeartbeats?: number;
	maxRestarts?: number;
	restartWindow?: number;
	restartBackoff?: number;
	maxRestartBackoff?: number;
}

export interface ClusterSpawnOptions {
	delay?: number;
	timeout?: number;
}

export interface QueueOptions {
	mode?: 'auto' | 'manual';
	timeout?: number;
}

export interface AdvancedOptions {
	ipcTimeout?: number;
	ipcMaxPayload?: number;
	terminationTimeout?: number;
	forceKillAfter?: number;
	queueUntilReady?: boolean;
	logMessagesInDebug?: boolean;
}

/* ----------------------------------- Manager ----------------------------------- */

export interface ClusterManagerCreateOptions<Mode extends ClusteringMode = ClusteringMode> {
	mode?: Mode;
	token?: string;

	totalShards?: number;
	totalClusters?: number;
	shardsPerClusters?: number;
	shardArgs?: string[];
	execArgv?: string[];
	respawn?: boolean;

	heartbeat?: ClusterHeartbeatOptions;
	spawnOptions?: ClusterSpawnOptions;
	queueOptions?: QueueOptions;

	clusterData?: Record<string, string | number | boolean>;
	clusterOptions?: Mode extends 'worker' ? WorkerOptions : ForkOptions;
	advanced?: AdvancedOptions;
}

export interface ClusterManagerOptions extends Omit<
	ClusterManagerCreateOptions,
	'clusterOptions' | 'clusterData' | 'heartbeat' | 'spawnOptions' | 'queueOptions' | 'mode'
> {
	mode: ClusteringMode;

	totalShards: number;
	totalClusters: number;
	shardsPerClusters: number;
	shardArgs: string[];
	execArgv: string[];

	clusterData: Record<string, string | number | boolean>;
	clusterOptions?: ForkOptions | WorkerOptions;

	heartbeat: Required<ClusterHeartbeatOptions>;
	spawnOptions: Required<ClusterSpawnOptions>;
	queueOptions: Required<QueueOptions>;
	advanced: Required<AdvancedOptions>;
	packageType: PackageType | null;
}

export interface ClusterClientData {
	ShardList: number[];
	TotalShards: number;
	ClusterCount: number;
	ClusterId: number;
	ClusterManagerMode: ClusteringMode;

	ClusterQueueMode: 'auto' | 'manual';
	QueueUntilReady: boolean;
	IpcTimeout: number;
	IpcMaxPending: number;
	IpcMaxPayload: number;

	FirstShardId: number;
	LastShardId: number;
}

/* ----------------------------------- Lifecycle ----------------------------------- */

export type ClusterLifecycleState = 'stopped' | 'starting' | 'ready' | 'running' | 'degraded' | 'stopping' | 'failed';
export type ClusterLifecycleReason =
	| 'spawn'
	| 'ready'
	| 'heartbeat-timeout'
	| 'client-unready'
	| 'ipc-disconnect'
	| 'process-exit'
	| 'spawn-timeout'
	| 'spawn-error'
	| 'termination-unverified'
	| 'manual-kill'
	| 'manual-respawn'
	| 'automatic-recovery'
	| 'manager-shutdown'
	| 'restart-budget-exhausted'
	| 'recluster'
	| 'unknown';

export interface ClusterLifecycleRecord {
	clusterId: number;
	generation: number;
	state: ClusterLifecycleState;
	previousState: ClusterLifecycleState;
	desired: 'running' | 'stopped';
	reason: ClusterLifecycleReason;
	timestamp: number;
	pid: number | null;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	restartAttempt: number;
	error?: Error;
}

export interface ClusterKillOptions {
	reason?: string;
	lifecycleReason?: 'manual-kill' | 'manager-shutdown' | 'recluster';
}

export interface EvalOptions<Context extends object = object> {
	cluster?: number | number[];
	shard?: number | number[];
	guildId?: string;
	context?: Context;
	timeout?: number;
	useAllSettled?: boolean;
}

export type ReClusterRestartMode = 'gracefulSwitch' | 'rolling';

export interface ReClusterOptions {
	totalShards?: number;
	totalClusters?: number;
	shardsPerClusters?: number;
	restartMode?: ReClusterRestartMode;
}

/* ----------------------------------- Events ----------------------------------- */

export interface ClusterManagerEvents<
	InternalManager extends RefClusterManager = RefClusterManager,
	InternalCluster extends RefCluster = RefCluster,
> {
	clientRequest: [message: ProcessMessage<DataType>];
	clusterCreate: [cluster: InternalCluster];
	clusterReady: [cluster: InternalCluster];
	clusterDeath: [cluster: InternalCluster, record: ClusterLifecycleRecord];
	clusterLifecycle: [cluster: InternalCluster, record: ClusterLifecycleRecord];
	clusterRestart: [cluster: InternalCluster, record: ClusterLifecycleRecord];
	clusterError: [cluster: InternalCluster, error: Error];
	message: [message: ProcessMessage<DataType>];
	debug: [message: string];
	ready: [manager: InternalManager];
	shutdown: [manager: InternalManager];
}

export interface ClusterEvents<
	InternalManager extends RefClusterManager = RefClusterManager,
	InternalCluster extends RefCluster = RefCluster,
> {
	spawn: [cluster: InternalCluster, thread: ChildProcess | Worker | null];
	ready: [cluster: InternalCluster];
	death: [cluster: InternalCluster, thread: ChildProcess | Worker | null];
	restart: [record: ClusterLifecycleRecord];
	lifecycle: [record: ClusterLifecycleRecord];
	degraded: [record: ClusterLifecycleRecord];
	message: [message: ProcessMessage<DataType>];
	debug: [message: string];
	error: [error: Error];
	manager: [manager: InternalManager];
}

export interface ClusterClientEvents<InternalClient extends ClientRefType = ClientRefType> {
	ready: [client: InternalClient];
	managerReady: [];
	unready: [client: InternalClient];
	message: [message: ProcessMessage<DataType>];
	debug: [message: string];
}

/* ----------------------------------- References ----------------------------------- */

export interface RefClusterManager {
	readonly options: ClusterManagerOptions;
	ready: boolean;
	readonly clusters: ReadonlyMap<number, RefCluster>;
	_debug(message: string): void;
}

export interface RefCluster<InternalClient extends ClientRefType = ClientRefType> {
	readonly id: number;
	readonly shardList: number[];
	readonly thread: { process: ChildProcess | Worker | null } | null;
	readonly exited: boolean;
	readonly respawning: boolean;
	readonly ready: boolean;
	readonly generationNumber: number;
	readonly lifecycleState?: string;
	spawn(timeout?: number): Promise<ChildProcess | Worker>;

	kill(options?: ClusterKillOptions): Promise<void>;

	respawn(delay?: number, timeout?: number): Promise<ChildProcess | Worker>;

	send<T extends Serializable>(message: SerializableInput<T>): Promise<void>;

	request<T extends Serializable, O = unknown>(message: SerializableInput<T>, options?: { timeout?: number }): Promise<Serialized<O>>;

	evalOnClient<T, P extends object>(script: string | ((client: InternalClient, context: Serialized<P> | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>>;

	evalOnGuild<T, P extends object>(guildId: string, script: string | ((client: InternalClient, context: Serialized<P> | undefined, guild: unknown) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>>;

	eval<T, P extends object>(script: string | ((cluster: unknown, context: Serialized<P> | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>>;

	_sendInstance(message: BaseMessage<DataType>): Promise<void>;

	_setHeartbeat(timestamp: number): void;

	_markDegraded(reason: ClusterLifecycleReason): void;

	_setReady(generation: number, packageType?: PackageType | null): void;

	_unexpectedExit(generation: number, exitCode: number | null, signal: NodeJS.Signals | null, reason: ClusterLifecycleReason): void;

	emit(event: string | symbol, ...args: unknown[]): boolean;

	on<K extends keyof ClusterEvents>(event: K, listener: (...args: ClusterEvents[K]) => void): this;
}

/* ----------------------------------- Messages ----------------------------------- */

export type DataType = 'normal' | 'reply' | 'eval' | 'respawnAll' | 'respawnSome' | 'readyOrSpawn' | 'heartbeat' | 'heartbeatAck' | 'error';

export interface EvalMessage<Context extends object = object> {
	script: string;
	options?: EvalOptions<Context>;
}

export interface RespawnMessage {
	clusterDelay?: number;
	respawnDelay?: number;
	timeout?: number;
	except?: number[];
}

export interface RespawnSomeMessage extends RespawnMessage {
	clusterIds: number[];
}

export interface DataTypes<Value = Serializable, Context extends object = object> {
	normal: Value;
	reply: Value;

	eval: EvalMessage<Context>;
	respawnAll: RespawnMessage;
	respawnSome: RespawnSomeMessage;

	readyOrSpawn: { packageType?: PackageType | null; reason?: string } | undefined;
	heartbeat: { nonce: string; sentAt: number };
	heartbeatAck: { nonce: string; receivedAt: number; ready: boolean; error?: string };
	error: { name: string; message: string; stack?: string };
}

export interface BaseMessage<D extends DataType, Value = Serializable, Context extends object = object> {
	_type: MessageTypes;
	_nonce?: string;
	_clusterId?: number;
	_generation?: number;
	data?: DataTypes<Value, Context>[D];
}

export type BaseMessageInput<D extends DataType, Value extends Serializable = Serializable> = Omit<BaseMessage<D, Value>, '_nonce'>;

export interface RefShardingClient {
	readonly cluster: unknown;
	login(...args: unknown[]): Promise<unknown>;
}

export interface RefShardingCoreClient {
	readonly cluster: unknown;
}

export type ClientRefType = RefShardingClient | RefShardingCoreClient;
export type ClientRefTypeLike = ClientRefType;
