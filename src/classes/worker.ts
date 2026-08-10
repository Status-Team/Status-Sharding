import WorkerThreads from 'node:worker_threads';

export interface WorkerThreadOptions extends WorkerThreads.WorkerOptions {
	clusterData?: Record<string, string | number | boolean>;

	terminationTimeout?: number;
	ipcMaxPayload?: number;
}

export interface WorkerClientOptions {
	ipcMaxPayload?: number;
}

interface TerminationOperation<T> {
	target: T;
	promise: Promise<boolean>;
}

export class Worker {
	public process: WorkerThreads.Worker | null = null;

	private readonly options: WorkerThreads.WorkerOptions;
	private readonly terminationTimeout: number;
	private readonly ipcMaxPayload: number;

	private readonly debugEmitter?: (message: string) => void;
	private readonly exited = new WeakSet<WorkerThreads.Worker>();
	private terminationOperation?: TerminationOperation<WorkerThreads.Worker>;

	constructor (private readonly file: string, options: WorkerThreadOptions, debugEmitter?: (message: string) => void) {
		const { clusterData, terminationTimeout, ipcMaxPayload, ...workerOptions } = options;
		const inheritedData = isRecord(workerOptions.workerData) ? workerOptions.workerData : {};

		this.options = { ...workerOptions, workerData: { ...inheritedData, ...clusterData } };
		this.terminationTimeout = terminationTimeout ?? 15_000;
		this.ipcMaxPayload = ipcMaxPayload ?? 8 * 1024 * 1024;

		this.debugEmitter = debugEmitter;
	}

	/* ----------------------------------- Lifecycle ----------------------------------- */

	public isAlive(target: WorkerThreads.Worker | null = this.process): boolean {
		return Boolean(target && target.threadId !== -1 && !this.exited.has(target));
	}

	public spawn(): WorkerThreads.Worker {
		const current = this.process;
		if (current && this.isAlive(current)) return current;

		const target = new WorkerThreads.Worker(this.file, this.options);
		target.once('exit', () => this.exited.add(target));

		this.process = target;
		this.debug(`The worker thread with ID ${target.threadId} was spawned.`);

		return target;
	}

	public async respawn(): Promise<WorkerThreads.Worker> {
		if (!(await this.kill())) throw new Error('WORKER_TERMINATION_UNVERIFIED | Refusing to replace a live worker.');

		return this.spawn();
	}

	public kill(): Promise<boolean> {
		const target = this.process;
		if (!target) {
			this.debug('A worker termination was requested, but no worker thread is active.');
			return Promise.resolve(true);
		}

		const activeOperation = this.terminationOperation;
		if (activeOperation && activeOperation.target === target) return activeOperation.promise;
		this.debug(`A termination was requested for worker thread ${target.threadId}.`);

		const promise = this.killTarget(target).finally(() => {
			const currentOperation = this.terminationOperation;
			if (currentOperation && currentOperation.target === target) this.terminationOperation = undefined;
		});

		this.terminationOperation = { target, promise };

		return promise;
	}

	private async killTarget(target: WorkerThreads.Worker): Promise<boolean> {
		if (!this.isAlive(target)) {
			if (this.process === target) this.process = null;
			return true;
		}

		let timeout: NodeJS.Timeout | undefined;
		try {
			let settled = false;

			const termination = target.terminate().then(() => {
				settled = true;
				if (timeout) clearTimeout(timeout);
				return true;
			});

			const deadline = new Promise<boolean>((resolve) => {
				timeout = setTimeout(() => {
					if (settled) return;
					this.debug(`The worker thread ${target.threadId} did not terminate before the ${this.terminationTimeout} millisecond deadline and may be unkillable.`);
					resolve(false);
				}, this.terminationTimeout);
			});

			const result = await Promise.race([termination, deadline]);
			if (timeout) clearTimeout(timeout);
			if (!result && this.isAlive(target)) return false;

			this.debug(`Termination was verified for worker thread ${target.threadId}.`);

			this.exited.add(target);
			if (this.process === target) this.process = null;

			return true;
		} catch (error: unknown) {
			if (timeout) clearTimeout(timeout);
			this.debug(`Worker thread ${target.threadId} termination failed with ${error instanceof Error ? error.message : String(error)}.`);
			
			if (!this.isAlive(target)) {
				this.exited.add(target);
				if (this.process === target) this.process = null;
				return true;
			}

			return false;
		}
	}

	/* ----------------------------------- IPC ----------------------------------- */

	public send<T extends object>(message: T): Promise<void> {
		if (!this.process || !this.isAlive(this.process)) return Promise.reject(new Error('WORKER_UNAVAILABLE | Worker is unavailable.'));

		if (JSON.stringify(message).length > this.ipcMaxPayload) return Promise.reject(new Error('IPC_PAYLOAD_TOO_LARGE | IPC payload exceeds the configured limit.'));

		try {
			this.debug(`An IPC message containing ${JSON.stringify(message).length} bytes is being sent to a worker thread.`);
			this.process.postMessage(message);
			return Promise.resolve();
		} catch (error: unknown) {
			this.debug(`Sending an IPC message to a worker thread failed with ${error instanceof Error ? error.message : String(error)}.`);
			return Promise.reject(error);
		}
	}

	private debug(message: string): void {
		const emitter = this.debugEmitter;
		if (emitter) emitter(message);
	}
}

export class WorkerClient {
	public readonly ipc: WorkerThreads.MessagePort | null = WorkerThreads.parentPort;

	private readonly ipcMaxPayload: number;
	private closed = false;

	constructor (options: WorkerClientOptions = {}) {
		this.ipcMaxPayload = options.ipcMaxPayload ?? 8 * 1024 * 1024;
		const ipc = this.ipc;
		if (ipc) ipc.once('close', () => {
			this.closed = true;
		});
	}

	public send<T extends object>(message: T): Promise<void> {
		if (!this.ipc || this.closed) return Promise.reject(new Error('IPC_PORT_CLOSED | Worker IPC is unavailable.'));

		if (JSON.stringify(message).length > this.ipcMaxPayload) return Promise.reject(new Error('IPC_PAYLOAD_TOO_LARGE | IPC payload exceeds the configured limit.'));

		try {
			this.ipc.postMessage(message);
			return Promise.resolve();
		} catch (error: unknown) {
			return Promise.reject(error);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
