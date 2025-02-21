import { ChildProcess, fork, ForkOptions } from 'child_process';
import { SerializableInput, Serializable } from '../types';

/** Options for the child process. */
export interface ChildProcessOptions extends ForkOptions {
	/** Data to send to the cluster. */
	clusterData?: NodeJS.ProcessEnv | undefined;
	/** The arguments to pass to the child process. */
	args?: string[] | undefined;
}

/** Child class. */
export class Child {
	/** The child process. */
	public process: ChildProcess | null = null;
	/** The options for the child process. */
	public processOptions: ForkOptions & { args?: string[] } = {};

	/** Creates an instance of Child. */
	constructor(private file: string, options: ChildProcessOptions) {
		this.processOptions = {};

		this.processOptions = {
			...this.processOptions,
			cwd: options.cwd,
			detached: options.detached,
			execArgv: options.execArgv,
			env: options.clusterData || options.env,
			execPath: options.execPath,
			gid: options.gid,
			serialization: options.serialization,
			signal: options.signal,
			killSignal: options.killSignal,
			silent: options.silent,
			stdio: options.stdio,
			uid: options.uid,
			windowsVerbatimArguments: options.windowsVerbatimArguments,
			timeout: options.timeout,
			args: options.args,
		};
	}

	/** Spawns the child process. */
	public spawn(): ChildProcess {
		this.process = fork(this.file, this.processOptions.args, this.processOptions);
		return this.process;
	}

	/** Respawns the child process. */
	public async respawn(): Promise<ChildProcess> {
		await this.kill();
		return this.spawn();
	}

	/** Kills the child process. */
	public async kill(): Promise<boolean> {
		if (!this.process || !this.process.pid) {
			console.warn('No process to kill.');
			return false;
		}

		try {
			this.process.kill();

			return new Promise((resolve, reject) => {
				this.process?.once('exit', () => {
					this.process?.removeAllListeners?.();
					resolve(true);
				});

				this.process?.once('error', (err) => {
					console.error('Error with child process:', err);
					reject(err);
				});
			});
		} catch (error) {
			console.error('Child termination failed:', error);
			return false;
		}
	}

	/** Sends a message to the child process. */
	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.process?.send(message as object, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}
}

/** Child client class. */
export class ChildClient {
	/** The IPC process. */
	readonly ipc: NodeJS.Process;

	/** Creates an instance of ChildClient. */
	constructor() {
		this.ipc = process;
	}

	/** Sends a message to the child process. */
	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.ipc.send?.(message, (err: Error | null) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	/** Gets the data of the child process. */
	public getData(): NodeJS.ProcessEnv {
		return this.ipc.env;
	}
}
