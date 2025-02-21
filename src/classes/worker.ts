import { Worker as WorkerThread, WorkerOptions, parentPort, workerData, MessagePort } from 'worker_threads';
import { SerializableInput, Serializable } from '../types';

/** Options for the worker. */
export interface WorkerThreadOptions extends WorkerOptions {
	/** Data to send to the cluster. */
	clusterData?: NodeJS.ProcessEnv | undefined;
}

/** Worker class. */
export class Worker {
	/** The worker process. */
	public process: WorkerThread | null = null;
	/** The options for the worker process. */
	public workerOptions: WorkerOptions;

	/** Creates an instance of Worker. */
	constructor(private file: string, options: WorkerThreadOptions) {
		this.workerOptions = {
			workerData: options.clusterData,
			...options,
		};
	}

	/** Spawns the worker. */
	public spawn(): WorkerThread {
		return (this.process = new WorkerThread(this.file, this.workerOptions));
	}

	/** Respawns the worker. */
	public async respawn(): Promise<WorkerThread> {
		await this.kill();
		return this.spawn();
	}

	/** Kills the worker. */
	public async kill(): Promise<boolean> {
		if (!this.process || !this.process.threadId) {
			console.warn('No process to kill.');
			return false;
		}

		try {
			this.process!.terminate();

			return new Promise((resolve, reject) => {
				this.process?.once('exit', () => {
					this.process?.removeAllListeners?.();
					resolve(true);
				});

				this.process?.once('error', (err) => {
					console.error('Error with worker thread:', err);
					reject(err);
				});
			});
		} catch (error) {
			console.error('Child termination failed:', error);
			return false;
		}
	}

	/** Sends a message to the worker. */
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		return new Promise<void>((resolve) => {
			try {
				this.process?.postMessage(message);
				resolve();
			} catch (error) {
				console.error('Data sending failed:', message);
				throw error;
			}
		});
	}
}

/** Worker client class. */
export class WorkerClient {
	/** The IPC port of the worker. */
	readonly ipc: MessagePort | null;

	/** Creates an instance of WorkerClient. */
	constructor() {
		this.ipc = parentPort;
	}

	/** Respawns the worker. */
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		return new Promise<void>((resolve) => {
			try {
				this.ipc?.postMessage(message);
				resolve();
			} catch (error) {
				console.error('Data sending failed:', message);
				throw error;
			}
		});
	}

	/** Gets the data from the worker. */
	public getData(): unknown {
		return workerData;
	}
}
