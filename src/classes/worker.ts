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
		if (this.process && this.process.threadId) return this.process;

		this.process = new WorkerThread(this.file, this.workerOptions);
		return this.process;
	}

	/** Respawns the worker. */
	public async respawn(): Promise<WorkerThread> {
		await this.kill();
		return this.spawn();
	}

	/** Kills the worker with proper cleanup. */
	public async kill(): Promise<boolean> {
		if (!this.process) {
			this._cleanup();
			return false;
		}
		if (!this.process.threadId) {
			this._cleanup();
			return true;
		}

		try {
			const forceTerminateTimer = setTimeout(() => {
				if (this.process && this.process.threadId) {
					console.warn('Force terminating worker thread.');
					void this.process.terminate().catch((error) => console.error('Force worker termination failed:', error));
				}
			}, 5000);

			return new Promise<boolean>((resolve) => {
				if (!this.process || !this.process.threadId) {
					clearTimeout(forceTerminateTimer);
					this._cleanup();
					resolve(false);
					return;
				}

				const cleanup = () => {
					clearTimeout(forceTerminateTimer);
					this._cleanup();
				};

				const onExit = () => {
					cleanup();
					resolve(true);
				};

				const onError = (err: Error) => {
					console.error('Error during worker termination:', err);
					if (!this.process?.threadId) cleanup();
					resolve(false);
				};

				this.process.once('exit', onExit);
				this.process.once('error', onError);

				void this.process.terminate().catch(onError);
			});
		} catch (error) {
			console.error('Worker termination failed:', error);
			return false;
		}
	}

	/** Clean up worker and listeners */
	private _cleanup(): void {
		if (this.process) this.process.removeAllListeners();
		this._listeners.clear();
		this.process = null;
	}

	/** Sends a message to the worker. */
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.process || !this.process.threadId) {
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
