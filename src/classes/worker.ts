import { Worker as WorkerThread, WorkerOptions, parentPort, MessagePort } from 'worker_threads';
import { ListenerManager, WorkerThreadEventMap } from './listen';
import { Serializable, SerializableInput } from '../types';

export interface WorkerThreadOptions extends WorkerOptions {
	/** Data to send to the cluster. */
	clusterData?: NodeJS.ProcessEnv | undefined;
}

export class Worker {
	/** The worker process. */
	public process: WorkerThread | null = null;
	/** The options for the worker process. */
	public workerOptions: WorkerOptions;

	/** Track if we're currently killing the process */
	private _isTerminating = false;
	/** Type-safe listener manager */
	private _listeners = new ListenerManager<WorkerThreadEventMap>();

	/** Creates an instance of Worker. */
	constructor (private file: string, options: WorkerThreadOptions) {
		this.workerOptions = {
			workerData: options.clusterData,
			...options,
		};
	}

	/** Spawns the worker. */
	public spawn(): WorkerThread {
		if (this.process) throw new Error('Worker already exists. Call kill() first before spawning a new one.');

		this.process = new WorkerThread(this.file, this.workerOptions);
		this._isTerminating = false;
		return this.process;
	}

	/** Respawns the worker. */
	public async respawn(): Promise<WorkerThread> {
		await this.kill();
		return this.spawn();
	}

	/** Kills the worker with proper cleanup. */
	public async kill(): Promise<boolean> {
		if (!this.process || !this.process.threadId || this._isTerminating) return false;

		this._isTerminating = true;

		try {
			const forceTerminateTimer = setTimeout(() => {
				if (this.process && this.process.threadId) {
					console.warn('Force terminating worker due to timeout');
					this.process.terminate();
				}
			}, 10000);

			return new Promise<boolean>((resolve, reject) => {
				if (!this.process) {
					clearTimeout(forceTerminateTimer);
					this._isTerminating = false;
					resolve(false);
					return;
				}

				const cleanup = () => {
					clearTimeout(forceTerminateTimer);
					this._cleanupListeners();
					this.process = null;
					this._isTerminating = false;
				};

				const onExit: WorkerThreadEventMap['exit'] = () => {
					cleanup();
					resolve(true);
				};

				const onError: WorkerThreadEventMap['error'] = (err) => {
					console.error('Error with worker thread during termination:', err);
					cleanup();
					reject(err);
				};

				this.process.removeAllListeners('exit');
				this.process.removeAllListeners('error');

				this.process.once('exit', onExit);
				this.process.once('error', onError);

				this.process.terminate();
			});
		} catch (error) {
			console.error('Worker termination failed:', error);
			this._isTerminating = false;
			return false;
		}
	}

	/** Clean up all event listeners */
	private _cleanupListeners(): void {
		if (this.process) this.process.removeAllListeners();
		this._listeners.clear();
	}

	/** Sends a message to the worker. */
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.process || this._isTerminating) {
				reject(new Error('No active worker to send message to'));
				return;
			}

			try {
				this.process.postMessage(message);
				resolve();
			} catch (error) {
				console.error('Data sending failed:', message);
				reject(error);
			}
		});
	}

	/** Add event listener with proper cleanup tracking */
	public addListener<K extends keyof WorkerThreadEventMap>(event: K, listener: WorkerThreadEventMap[K]): void {
		if (!this.process) return;

		// Remove existing listener for this event if it exists
		const existingListener = this._listeners.get(event);
		if (existingListener) {
			this.process.removeListener(event, existingListener);
		}

		// Store and add the new listener
		this._listeners.set(event, listener);
		this.process.on(event, listener);
	}

	/** Remove specific event listener */
	public removeListener<K extends keyof WorkerThreadEventMap>(event: K): void {
		const listener = this._listeners.get(event);
		if (this.process && listener) {
			this.process.removeListener(event, listener);
			this._listeners.delete(event);
		}
	}

	/** Get current listener for an event */
	public getListener<K extends keyof WorkerThreadEventMap>(event: K): WorkerThreadEventMap[K] | undefined {
		return this._listeners.get(event);
	}

	/** Check if listener exists for event */
	public hasListener<K extends keyof WorkerThreadEventMap>(event: K): boolean {
		return this._listeners.has(event);
	}
}

/** Worker client class. */
export class WorkerClient {
	/** The IPC port of the worker. */
	readonly ipc: MessagePort | null;

	/** Creates an instance of WorkerClient. */
	constructor () {
		this.ipc = parentPort;
	}

	/** Sends a message to the worker. */
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.ipc) {
				reject(new Error('No IPC port available'));
				return;
			}

			try {
				this.ipc.postMessage(message);
				resolve();
			} catch (error) {
				console.error('Data sending failed:', message);
				reject(error);
			}
		});
	}
}
