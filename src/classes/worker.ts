import { Worker as WorkerThread, WorkerOptions, parentPort, workerData, MessagePort } from 'worker_threads';
import { SerializableInput, Serializable } from '../types';

/**
 * Options for the worker.
 * @export
 * @interface WorkerThreadOptions
 * @typedef {WorkerThreadOptions}
 * @extends {WorkerOptions}
 */
export interface WorkerThreadOptions extends WorkerOptions {
	/**
	 * Data to send to the cluster.
	 * @type {(NodeJS.ProcessEnv | undefined)}
	 */
	clusterData: NodeJS.ProcessEnv | undefined;
}

/**
 * Worker class.
 * @export
 * @class Worker
 * @typedef {Worker}
 */
export class Worker {
	/**
	 * The worker process.
	 * @type {(WorkerThread | null)}
	 */
	public process: WorkerThread | null = null;
	/**
	 * The options for the worker process.
	 * @type {WorkerOptions}
	 */
	public workerOptions: WorkerOptions;

	/**
	 * Creates an instance of Worker.
	 * @constructor
	 * @param {string} file - The file to run.
	 * @param {WorkerThreadOptions} options - The options for the worker process.
	 */
	constructor(private file: string, options: WorkerThreadOptions) {
		this.workerOptions = {
			workerData: options.clusterData,
			...options,
		};
	}

	/**
	 * Spawns the worker.
	 * @returns {WorkerThread} The worker.
	 */
	public spawn(): WorkerThread {
		return (this.process = new WorkerThread(this.file, this.workerOptions));
	}

	/**
	 * Respawns the worker.
	 * @returns {Worker} The worker.
	 */
	public respawn(): WorkerThread {
		this.kill();
		return this.spawn();
	}

	/**
	 * Kills the worker.
	 * @returns {Promise<boolean>} The promise.
	 */
	public kill(): Promise<boolean> {
		this.process?.removeAllListeners();
		return typeof this.process?.terminate() === 'number' ? Promise.resolve(true) : Promise.resolve(false);
	}

	/**
	 * Sends a message to the worker.
	 * @template {Serializable} T - The type of the message.
	 * @param {(SerializableInput<T, true> | unknown)} message - The message to send.
	 * @returns {Promise<void>} The promise.
	 */
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		return new Promise<void>((resolve) => {
			this.process?.postMessage(message);
			resolve();
		});
	}
}

/**
 * Worker client class.
 * @export
 * @class WorkerClient
 * @typedef {WorkerClient}
 */
export class WorkerClient {
	/**
	 * The IPC port of the worker.
	 * @readonly
	 * @type {(MessagePort | null)}
	 */
	readonly ipc: MessagePort | null;

	/**
	 * Creates an instance of WorkerClient.
	 * @constructor
	 */
	constructor() {
		this.ipc = parentPort;
	}

	/**
	 * Respawns the worker.
	 * @template {Serializable} T - The type of the message.
	 * @param {(SerializableInput<T, true> | unknown)} message - The message to send.
	 * @returns {Promise<void>} The promise.
	 */
	public send<T extends Serializable>(message: SerializableInput<T, true> | unknown): Promise<void> {
		return new Promise<void>((resolve) => {
			this.ipc?.postMessage(message);
			resolve();
		});
	}

	/**
	 *  Gets the data from the worker.
	 * @returns {unknown} The data.
	 */
	public getData(): unknown {
		return workerData;
	}
}
