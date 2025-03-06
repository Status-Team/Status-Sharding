import { SerializableInput, Serializable } from '../types';
import Bun, { Subprocess } from 'bun';

/** Options for the child process. */
export interface ChildProcessOptions {
	/** Data to send to the cluster. */
	clusterData?: NodeJS.ProcessEnv | undefined;
	/** The arguments to pass to the child process. */
	args?: string[] | undefined;
	/** Other Bun spawn options */
	cwd?: string;
	detached?: boolean;
	env?: NodeJS.ProcessEnv;
	timeout?: number;
	serialization?: 'json' | 'advanced';
}

/** Child class. */
export class Child {
	/** The child process. */
	public process: Bun.Subprocess | null = null;
	/** The options for the child process. */
	public processOptions: ChildProcessOptions = {};

	/** Creates an instance of Child. */
	constructor (private file: string, options: ChildProcessOptions) {
		this.processOptions = { ...options };
	}

	/** Spawns the child process. */
	public spawn(): Subprocess {
		this.process = Bun.spawn([this.file, ...(this.processOptions.args || [])], {
			cwd: this.processOptions.cwd,
			detached: this.processOptions.detached,
			env: this.processOptions.env,
			timeout: this.processOptions.timeout,
			serialization: this.processOptions.serialization,
		});

		return this.process;
	}

	/** Respawns the child process. */
	public async respawn(): Promise<Subprocess> {
		await this.kill();
		return this.spawn();
	}

	/** Kills the child process. */
	public async kill(): Promise<boolean> {
		if (!this.process) {
			console.warn('No process to kill.');
			return false;
		}

		try {
			this.process.kill();
			await this.process.exited;

			return true;
		} catch (error) {
			console.error('Child termination failed:', error);
			return false;
		}
	}

	/** Sends a message to the child process. */
	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			try {
				this.process?.send(message as object);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}
}

/** Child client class. */
export class ChildClient {
	/** The IPC process. */
	readonly ipc: NodeJS.Process;

	/** Creates an instance of ChildClient. */
	constructor () {
		this.ipc = process;
	}

	/** Sends a message to the child process. */
	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			try {
				this.ipc?.send?.(message as object);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}

	/** Gets the data of the child process. */
	public getData(): NodeJS.ProcessEnv {
		return this.ipc.env;
	}
}
