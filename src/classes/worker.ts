import { Worker as WorkerThread, WorkerOptions, parentPort, workerData, MessagePort } from 'worker_threads';
import { Serializable } from 'child_process';

export interface WorkerThreadOptions extends WorkerOptions {
	clusterData: NodeJS.ProcessEnv | undefined;
}

export class Worker {
	public process: WorkerThread | null = null;
	public workerOptions: WorkerOptions;

	constructor(private file: string, options: WorkerThreadOptions) {
		this.workerOptions = {
			workerData: options.clusterData,
			...options,
		};
	}

	public spawn() {
		return (this.process = new WorkerThread(this.file, this.workerOptions));
	}

	public respawn() {
		this.kill();
		return this.spawn();
	}

	public kill() {
		this.process?.removeAllListeners();
		return this.process?.terminate();
	}

	public send(message: Serializable): Promise<void> {
		return new Promise<void>((resolve) => {
			this.process?.postMessage(message);
			resolve();
		});
	}
}

export class WorkerClient {
	readonly ipc: MessagePort | null;

	constructor() {
		this.ipc = parentPort;
	}

	public send(message: Serializable): Promise<void> {
		return new Promise<void>((resolve) => {
			this.ipc?.postMessage(message);
			resolve();
		});
	}

	public getData(): unknown {
		return workerData;
	}
}
