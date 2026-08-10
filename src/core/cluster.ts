import { MessageTypes, type BaseMessage, type ClusterKillOptions, type ClusterLifecycleReason, type ClusterLifecycleRecord, type DataType, type EvalOptions, type RefCluster, type RefClusterManager, type Serializable, type SerializableInput, type Serialized, type ValidIfSerializable, type Awaitable, type ClientRefType, type ClusterEvents } from '../types.js';
import type { ChildProcess, ForkOptions } from 'node:child_process';
import { ShardingUtils } from '../other/shardingUtils.js';
import type { WorkerOptions } from 'node:worker_threads';
import type { Guild } from 'discord.js';
import { Worker } from '../classes/worker.js';
import { Child } from '../classes/child.js';
import EventEmitter from 'node:events';

export type RuntimeHandle = Child | Worker;
type WorkerThreadHandle = ReturnType<Worker['spawn']>;

export interface ClusterHost<InternalClient extends ClientRefType = ClientRefType> extends RefClusterManager {
	readonly file: string;
	readonly clusters: ReadonlyMap<number, RefCluster<InternalClient>>;

	createClusterEnvironment(cluster: RefCluster<InternalClient>): NodeJS.ProcessEnv;
	handleClusterMessage(cluster: RefCluster<InternalClient>, generation: number, message: unknown): Promise<void>;
	handleClusterExit(cluster: RefCluster<InternalClient>, generation: number, exitCode: number | null, signal: NodeJS.Signals | null): void;
	handleClusterError(cluster: RefCluster<InternalClient>, generation: number, error: Error): void;
	handleClusterReady(cluster: RefCluster<InternalClient>, generation: number, packageType?: 'discord.js' | '@discordjs/core' | null): void;
	requestFromCluster<T>(cluster: RefCluster<InternalClient>, message: BaseMessage<DataType>, timeout?: number): Promise<T>;
	rejectClusterGeneration?(cluster: RefCluster<InternalClient>, generation: number, error: Error): void;
	broadcast<T extends Serializable>(message: SerializableInput<T>, ignore?: number[]): Promise<void>;
	evalOnGuild<T, P extends object, C = InternalClient>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild: Guild | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>>;
	_debug(message: string): void;
}

export declare interface Cluster<
	InternalManager extends RefClusterManager = RefClusterManager,
	InternalClient extends ClientRefType = ClientRefType,
> {
	emit<K extends keyof ClusterEvents<InternalManager, this>>(event: K, ...args: ClusterEvents<InternalManager, this>[K]): boolean;
	on<K extends keyof ClusterEvents<InternalManager, this>>(event: K, listener: (...args: ClusterEvents<InternalManager, this>[K]) => void): this;
	once<K extends keyof ClusterEvents<InternalManager, this>>(event: K, listener: (...args: ClusterEvents<InternalManager, this>[K]) => void): this;
	off<K extends keyof ClusterEvents<InternalManager, this>>(event: K, listener: (...args: ClusterEvents<InternalManager, this>[K]) => void): this;
}

export type ClusterState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'stopping' | 'failed';

export interface SpawnWaiter {
	generation: number;
	resolve: () => void;
	reject: (error: Error) => void;
	timer?: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isForkOptions(value: ForkOptions | WorkerOptions): value is ForkOptions {
	return 'env' in value || 'stdio' in value || 'uid' in value;
}

function isWorkerOptions(value: ForkOptions | WorkerOptions): value is WorkerOptions {
	return 'workerData' in value || 'argv' in value;
}

export class Cluster<
	InternalManager extends RefClusterManager = RefClusterManager,
	InternalClient extends ClientRefType = ClientRefType,
> extends EventEmitter {
	private state: ClusterState = 'stopped';
	private desiredState: 'running' | 'stopped' = 'stopped';
	private generation = 0;
	private activeThread: RuntimeHandle | null = null;
	private operation: Promise<unknown> = Promise.resolve();
	private spawnWaiter?: { generation: number; resolve: () => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };

	private deathGeneration: number | null = null;
	private restartPromise?: Promise<void>;
	private restartDelayTimer?: NodeJS.Timeout;
	private restartDelayCancel?: () => void;
	private restartCancelled = false;
	private killPromise?: Promise<void>;
	private restartTimes: number[] = [];
	private restartAttempt = 0;

	private exitCode: number | null = null;
	private exitSignal: NodeJS.Signals | null = null;

	constructor (public readonly manager: InternalManager & ClusterHost<InternalClient>, public readonly id: number, public readonly shardList: number[]) {
		super();

		if (!Number.isInteger(id) || id < 0) throw new RangeError('CLUSTER_ID_INVALID | Cluster IDs must be non-negative integers.');
		if (!shardList.length || new Set(shardList).size !== shardList.length) throw new RangeError('CLUSTER_SHARD_LIST_INVALID | A cluster requires unique shard IDs.');
	}

	/* ----------------------------------- State ----------------------------------- */

	public get totalShards(): number {
		return this.manager.options.totalShards;
	}

	public get totalClusters(): number {
		return this.manager.options.totalClusters;
	}

	public get ready(): boolean {
		return this.state === 'ready';
	}

	public get exited(): boolean {
		return this.activeThread === null;
	}

	public get respawning(): boolean {
		return this.restartPromise !== undefined;
	}

	public get thread(): RuntimeHandle | null {
		return this.activeThread;
	}

	public get lifecycleState(): ClusterState {
		return this.state;
	}

	public get generationNumber(): number {
		return this.generation;
	}

	public get lastHeartbeatReceived(): number | undefined {
		return this.lastAckAt;
	}

	private lastAckAt?: number;

	/* ----------------------------------- Lifecycle ----------------------------------- */

	public _markHeartbeat(timestamp: number): void {
		if (this.activeThread) this.lastAckAt = timestamp;
	}

	public spawn(timeout = this.manager.options.spawnOptions.timeout): Promise<ChildProcess | WorkerThreadHandle> {
		return this.serialized(async () => {
			this.debug(`Cluster ${this.id} received a spawn request while it was ${this.state} at generation ${this.generation}.`);

			if (this.activeThread && this.isAlive()) {
				if (!(this.activeThread instanceof Child) || this.activeThread.isUsable()) return this.processAfterSpawn();

				this.state = 'stopping';
				this.desiredState = 'stopped';
				const runtime = this.activeThread;

				if (!(await runtime.kill())) throw new Error(`CLUSTERING_TERMINATION_UNVERIFIED | Cluster ${this.id} cannot replace a disconnected child.`);
				if (this.activeThread === runtime) this.activeThread = null;
			}

			return this.spawnInternal(timeout);
		});
	}

	private async spawnInternal(timeout: number): Promise<ChildProcess | WorkerThreadHandle> {
		const previousState = this.state;
		this.desiredState = 'running';
		this.state = 'starting';

		this.generation += 1;
		const generation = this.generation;

		this.exitCode = null;
		this.exitSignal = null;
		this.lastAckAt = Date.now();

		this.debug(`Cluster ${this.id} is starting generation ${generation} for shards ${this.shardList.join(', ')}.`);
		this.emitSafe('lifecycle', this.record('starting', 'spawn', previousState));

		const metadata = this.manager.createClusterEnvironment(this);
		const options = this.manager.options;
		const configured = options.clusterOptions ?? {};
		const requiredArgs = [...options.shardArgs, '--clusterId', String(this.id), '--shards', this.shardList.join(',')];

		let runtime: RuntimeHandle;
		if (options.mode === 'process') {
			const processOptions = isForkOptions(configured) ? configured : {};
			runtime = new Child(this.manager.file, {
				...processOptions,
				args: requiredArgs,
				env: { ...process.env, ...(processOptions.env ?? {}), ...metadata },
				execArgv: options.execArgv.length ? options.execArgv : (processOptions.execArgv ?? []),

				terminationTimeout: options.advanced.terminationTimeout,
				forceKillAfter: options.advanced.forceKillAfter,
				ipcTimeout: options.advanced.ipcTimeout,
				ipcMaxPayload: options.advanced.ipcMaxPayload,
			}, (message) => this.debug(`Cluster ${this.id}: ${message}`));
		} else {
			const workerOptions = isWorkerOptions(configured) ? configured : {};
			runtime = new Worker(this.manager.file, {
				...workerOptions,
				workerData: { ...(isRecord(workerOptions.workerData) ? workerOptions.workerData : {}), ...metadata },
				argv: [...(workerOptions.argv ?? []), ...requiredArgs],

				terminationTimeout: options.advanced.terminationTimeout,
				ipcMaxPayload: options.advanced.ipcMaxPayload,
			}, (message) => this.debug(`Cluster ${this.id}: ${message}`));
		}

		this.activeThread = runtime;
		const thread = runtime.spawn();
		this.debug(`Cluster ${this.id} spawned its runtime for generation ${generation}.`);

		let exited = false;
		let disconnectTimer: NodeJS.Timeout | undefined;
		if ('on' in thread) {
			thread.on('error', (error) => this.manager.handleClusterError(this, generation, error));
			thread.on('message', (message) => void this.manager.handleClusterMessage(this, generation, message));

			if (options.mode === 'process') {
				thread.on('disconnect', () => {
					this.debug(`Cluster ${this.id} lost its IPC connection during generation ${generation}.`);
					if (disconnectTimer) return;

					disconnectTimer = setTimeout(() => {
						disconnectTimer = undefined;
						if (!exited && this.activeThread === runtime && runtime.isAlive()) this.manager.handleClusterExit(this, generation, null, null);
					}, 250);

					disconnectTimer.unref();
				});
			}

			thread.on('exit', (code: number | null, signal?: NodeJS.Signals | null) => {
				this.debug(`Cluster ${this.id} runtime exited during generation ${generation} with code ${code ?? 'null'} and signal ${signal ?? 'null'}.`);
				if (exited) return;
				exited = true;

				if (disconnectTimer) clearTimeout(disconnectTimer);
				this.manager.handleClusterExit(this, generation, code, signal ?? null);
			});
		}

		this.emitSafe('spawn', this, thread);

		try {
			await this.waitForReady(generation, timeout);
			if (generation !== this.generation || this.activeThread !== runtime || !this.isAlive()) throw new Error('CLUSTER_GENERATION_LOST | Cluster changed while starting.');
			return thread;
		} catch (error: unknown) {
			this.rejectSpawn(error instanceof Error ? error : new Error(String(error)));
			if (this.activeThread === runtime) {
				this.desiredState = 'stopped';
				this.state = 'stopping';

				const terminated = await runtime.kill();
				if (terminated) this.activeThread = null;
				else this.reportTerminationFailure(generation, 'spawn cleanup');
			}

			this.state = 'failed';
			this.emitSafe('lifecycle', this.record('failed', error instanceof Error && error.message.includes('READY_TIMEOUT') ? 'spawn-timeout' : 'spawn-error', 'starting'));
			throw error;
		}
	}

	private waitForReady(generation: number, timeout: number): Promise<void> {
		if (this.ready && generation === this.generation) return Promise.resolve();

		return new Promise<void>((resolve, reject) => {
			const waiter: SpawnWaiter = { generation, resolve, reject };
			if (timeout >= 0) {
				waiter.timer = setTimeout(() => {
					this.spawnWaiter = undefined;
					reject(new Error(`CLUSTERING_READY_TIMEOUT | Cluster ${this.id} did not become ready within ${timeout}ms.`));
				}, timeout);
			}

			this.spawnWaiter = waiter;
		});
	}

	public async kill(options: ClusterKillOptions = {}): Promise<void> {
		if (this.killPromise) return this.killPromise;
		this.debug(`Cluster ${this.id} received a kill request because ${options.lifecycleReason ?? 'manual-kill'}.`);

		if (this.restartPromise) {
			this.restartCancelled = true;
			this.restartDelayCancel?.();
			this.debug(`Cluster ${this.id} cancelled its pending respawn before handling the kill request.`);
		}

		if (this.spawnWaiter) {
			this.debug(`Cluster ${this.id} cancelled its pending ready wait before handling the kill request.`);
			this.rejectSpawn(new Error(`CLUSTER_SPAWN_CANCELLED | Cluster ${this.id} was asked to stop before becoming ready.`));
		}

		this.killPromise = this.serialized(async () => {
			this.desiredState = 'stopped';
			if (!this.activeThread) {
				this.state = 'stopped';
				return;
			}

			const previousState = this.state;
			this.state = 'stopping';

			const runtime = this.activeThread;
			const terminated = await runtime.kill();
			if (!terminated) {
				this.state = 'failed';
				throw this.reportTerminationFailure(this.generation, 'manual kill');
			}

			if (this.activeThread === runtime) this.activeThread = null;

			this.state = 'stopped';
			this.resolveSpawn();

			this.emitSafe('lifecycle', this.record('stopped', options.lifecycleReason ?? 'manual-kill', previousState));
		}).finally(() => {
			this.killPromise = undefined;
		});

		return this.killPromise;
	}

	public async respawn(delay = this.manager.options.spawnOptions.delay, timeout = this.manager.options.spawnOptions.timeout): Promise<ChildProcess | WorkerThreadHandle> {
		if (this.restartPromise) {
			await this.restartPromise;
			return this.processAfterRespawn();
		}

		this.debug(`Cluster ${this.id} received a respawn request with a ${delay} millisecond delay and a ${timeout} millisecond timeout.`);

		this.restartCancelled = false;
		this.restartPromise = this.serialized(async () => {
			this.desiredState = 'stopped';
			this.restartAttempt += 1;
			const rejectGeneration = this.manager.rejectClusterGeneration;
			if (rejectGeneration) rejectGeneration.call(this.manager, this, this.generation, new Error(`CLUSTER_RESTARTING | Cluster ${this.id} generation ${this.generation} is being replaced.`));

			await this.killForRestart();
			await this.waitForRestartDelay(delay);
			if (this.restartCancelled) return;

			await this.spawnInternal(timeout);
		}).finally(() => {
			this.restartPromise = undefined;
		});

		await this.restartPromise;
		return this.processAfterRespawn();
	}

	private processAfterSpawn(): ChildProcess | WorkerThreadHandle {
		const runtime = this.activeThread;
		const process = runtime ? runtime.process : null;

		if (!process) throw new Error(`CLUSTERING_NO_CHILD_EXISTS | Cluster ${this.id} has no runtime after spawn.`);
		return process;
	}

	private processAfterRespawn(): ChildProcess | WorkerThreadHandle {
		if (this.restartCancelled) throw new Error(`CLUSTER_RESPAWN_CANCELLED | Cluster ${this.id} respawn was cancelled.`);
		return this.processAfterSpawn();
	}

	private async killForRestart(): Promise<void> {
		if (!this.activeThread) return;

		this.state = 'stopping';
		const runtime = this.activeThread;

		if (!(await runtime.kill())) throw this.reportTerminationFailure(this.generation, 'respawn cleanup');
		if (this.activeThread === runtime) this.activeThread = null;
	}

	private waitForRestartDelay(delay: number): Promise<void> {
		if (delay <= 0) return Promise.resolve();

		return new Promise<void>((resolve) => {
			let settled = false;

			const finish = () => {
				if (settled) return;
				settled = true;

				if (this.restartDelayTimer) clearTimeout(this.restartDelayTimer);
				this.restartDelayTimer = undefined;
				this.restartDelayCancel = undefined;
				resolve();
			};

			this.restartDelayCancel = finish;
			this.restartDelayTimer = setTimeout(finish, delay);
		});
	}

	public async recover(reason: ClusterLifecycleReason): Promise<void> {
		if (!this.manager.options.respawn || this.desiredState !== 'running' || this.restartPromise) return;
		this.debug(`Cluster ${this.id} requested recovery because of ${reason}.`);

		const now = Date.now();
		const window = this.manager.options.heartbeat.restartWindow;

		this.restartTimes = this.restartTimes.filter((timestamp) => now - timestamp <= window);
		if (this.manager.options.heartbeat.maxRestarts !== -1 && this.restartTimes.length >= this.manager.options.heartbeat.maxRestarts) {
			this.state = 'failed';
			this.emitSafe('lifecycle', this.record('failed', 'restart-budget-exhausted'));
			return;
		}

		this.restartTimes.push(now);
		const backoff = Math.min(this.manager.options.heartbeat.maxRestartBackoff, this.manager.options.heartbeat.restartBackoff * this.restartTimes.length);
		this.emitSafe('restart', this.record('starting', reason));

		try {
			await this.respawn(backoff, this.manager.options.spawnOptions.timeout);
		} catch (error: unknown) {
			if (this.restartCancelled) {
				this.debug(`Cluster ${this.id} cancelled automatic recovery because a stop request was received.`);
				return;
			}

			this.manager.handleClusterError(this, this.generation, error instanceof Error ? error : new Error(String(error)));
		}
	}

	/* ----------------------------------- IPC ----------------------------------- */

	public async send<T extends Serializable>(message: SerializableInput<T>): Promise<void> {
		if (!this.activeThread) throw new Error(`CLUSTERING_NO_CHILD_EXISTS | Cluster ${this.id} has no runtime.`);
		await this.activeThread.send({ _type: MessageTypes.CustomMessage, data: message });
	}

	public request<T extends Serializable, O = unknown>(message: SerializableInput<T>, options: { timeout?: number } = {}): Promise<Serialized<O>> {
		return this.manager.requestFromCluster<Serialized<O>>(this, { _type: MessageTypes.CustomRequest, _nonce: ShardingUtils.generateNonce(), data: message }, options.timeout);
	}

	public broadcast<T extends Serializable>(message: SerializableInput<T>, sendSelf = false): Promise<void> {
		return this.manager.broadcast(message, sendSelf ? [] : [this.id]);
	}

	public async eval<T, P extends object, C = Cluster<InternalManager, InternalClient>>(script: string | ((cluster: C, context: Serialized<P>) => Awaitable<T>), options?: { context?: P }): Promise<ValidIfSerializable<T>> {
		if (typeof script === 'function') return await new Function('cluster', 'context', `return (${script.toString()})(cluster, context);`).call(this, this, options?.context);
		return await new Function('cluster', 'context', `return (${script})`).call(this, this, options?.context);
	}

	public evalOnClient<T, P extends object, C = InternalClient>(script: string | ((client: C, context: Serialized<P>) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		return this.manager.requestFromCluster<ValidIfSerializable<T>>(this, {
			_type: MessageTypes.ClientEvalRequest,
			_nonce: ShardingUtils.generateNonce(),
			data: { script: typeof script === 'function' ? script.toString() : script, options },
		}, options?.timeout);
	}

	public evalOnGuild<T, P extends object, C = InternalClient>(guildId: string, script: string | ((client: C, context: Serialized<P>, guild: Guild | undefined) => Awaitable<T>), options?: EvalOptions<P>): Promise<ValidIfSerializable<T>> {
		return this.manager.requestFromCluster<ValidIfSerializable<T>>(this, {
			_type: MessageTypes.ClientEvalRequest,
			_nonce: ShardingUtils.generateNonce(),
			data: { script: typeof script === 'function' ? script.toString() : script, options: { ...options, guildId } },
		}, options?.timeout);
	}

	public _sendInstance(message: BaseMessage<DataType>): Promise<void> {
		if (!this.activeThread) return Promise.reject(new Error(`CLUSTERING_NO_CHILD_EXISTS | Cluster ${this.id} has no runtime.`));
		return this.activeThread.send(message);
	}

	public _setReady(generation: number, packageType?: 'discord.js' | '@discordjs/core' | null): void {
		if (generation !== this.generation || !this.activeThread || this.desiredState !== 'running') return;
		this.debug(`Cluster ${this.id} accepted its ready signal for generation ${generation}.`);

		const previousState = this.state;
		this.state = 'ready';
		this.lastAckAt = Date.now();
		this.resolveSpawn();

		this.emitSafe('lifecycle', this.record('ready', 'ready', previousState));
		this.emitSafe('ready', this);

		this.manager.handleClusterReady(this, generation, packageType);
	}

	public _setHeartbeat(timestamp: number): void {
		this.lastAckAt = timestamp;
	}

	public _unexpectedExit(generation: number, exitCode: number | null, signal: NodeJS.Signals | null, reason: ClusterLifecycleReason): void {
		if (generation !== this.generation || this.desiredState === 'stopped') return;
		if (this.deathGeneration === generation) return;

		this.debug(`Cluster ${this.id} exited unexpectedly during generation ${generation} because of ${reason}.`);
		this.deathGeneration = generation;
		this.exitCode = exitCode;
		this.exitSignal = signal;

		const runtime = this.activeThread;
		const thread = runtime ? runtime.process : null;

		if (!runtime || !runtime.isAlive()) this.activeThread = null;
		const previousState = this.state;

		this.state = 'failed';
		this.manager.ready = false;
		this.rejectSpawn(new Error(`CLUSTER_EXITED | Cluster ${this.id} exited unexpectedly.`));

		const error = new Error(`CLUSTER_EXITED | Cluster ${this.id} exited unexpectedly.`);
		const rejectGeneration = this.manager.rejectClusterGeneration;
		if (rejectGeneration) rejectGeneration.call(this.manager, this, generation, error);

		this.emitSafe('death', this, thread);
		this.emitSafe('lifecycle', this.record('failed', reason, previousState));

		void (async () => {
			try {
				const terminated = runtime ? await runtime.kill() : true;
				if (!terminated) {
					this.state = 'failed';
					this.reportTerminationFailure(generation, 'automatic recovery cleanup');
					this.emitSafe('lifecycle', this.record('failed', 'termination-unverified'));
					return;
				}
				if (this.activeThread === runtime) this.activeThread = null;
				await this.recover(reason);
			} catch (error: unknown) {
				this.manager.handleClusterError(this, generation, error instanceof Error ? error : new Error(String(error)));
			}
		})();
	}

	public _markDegraded(reason: ClusterLifecycleReason): void {
		if (this.state === 'degraded') {
			if (reason === 'heartbeat-timeout') void this.recover(reason);
			return;
		}

		if (this.state !== 'ready') return;
		this.debug(`Cluster ${this.id} was marked degraded because of ${reason}.`);
		const previousState = this.state;

		this.state = 'degraded';
		this.manager.ready = false;

		this.emitSafe('degraded', this.record('degraded', reason, previousState));
		if (reason === 'heartbeat-timeout') void this.recover(reason);
	}

	/* ----------------------------------- Internal ----------------------------------- */

	private isAlive(): boolean {
		const runtime = this.activeThread;
		if (!runtime) return false;
		return runtime.isAlive();
	}

	private debug(message: string): void {
		this.emitSafe('debug', message);
		this.manager._debug(message);
	}

	private reportTerminationFailure(generation: number, operation: string): Error {
		const error = new Error(`CLUSTERING_TERMINATION_UNVERIFIED | Cluster ${this.id} remained alive after ${operation}. Automatic respawn is suppressed.`);
		this.debug(`Cluster ${this.id} could not verify termination during ${operation} for generation ${generation}; automatic respawn is suppressed.`);
		this.manager.handleClusterError(this, generation, error);
		return error;
	}

	private serialized<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.operation.then(operation, operation);
		this.operation = next.then(
			() => undefined,
			() => undefined,
		);

		return next;
	}

	private resolveSpawn(): void {
		if (!this.spawnWaiter) return;
		if (this.spawnWaiter.timer) clearTimeout(this.spawnWaiter.timer);

		this.spawnWaiter.resolve();
		this.spawnWaiter = undefined;
	}

	private rejectSpawn(error: Error): void {
		if (!this.spawnWaiter) return;
		if (this.spawnWaiter.timer) clearTimeout(this.spawnWaiter.timer);
		
		this.spawnWaiter.reject(error);
		this.spawnWaiter = undefined;
	}

	private record(state: ClusterState, reason: ClusterLifecycleReason, previousState = this.state): ClusterLifecycleRecord {
		return {
			clusterId: this.id,
			generation: this.generation,
			state,
			previousState,
			desired: this.desiredState,
			reason,
			timestamp: Date.now(),
			pid: this.activeThread instanceof Child && this.activeThread.process ? this.activeThread.process.pid ?? null : null,
			exitCode: this.exitCode,
			signal: this.exitSignal,
			restartAttempt: this.restartAttempt,
		};
	}

	private emitSafe(event: string, ...args: unknown[]): void {
		for (const listener of this.rawListeners(event)) {
			try {
				Reflect.apply(listener, this, args);
			} catch (error: unknown) {
				if (event !== 'error') this.emitSafe('error', error instanceof Error ? error : new Error(String(error)));
			}
		}
	}
}
