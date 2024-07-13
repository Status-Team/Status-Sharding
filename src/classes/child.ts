import { ChildProcess, fork, ForkOptions } from 'child_process';
import { SerializableInput, Serializable } from '../types';

/**
 * Options for the child process.
 * @export
 * @interface ChildProcessOptions
 * @typedef {ChildProcessOptions}
 * @extends {ForkOptions}
 */
export interface ChildProcessOptions extends ForkOptions {
	/**
	 * Data to send to the cluster.
	 * @type {(NodeJS.ProcessEnv | undefined)}
	 */
	clusterData?: NodeJS.ProcessEnv | undefined;
	/**
	 * The arguments to pass to the child process.
	 * @type {?(string[] | undefined)}
	 */
	args?: string[] | undefined;
}

/**
 * Child class.
 * @export
 * @class Child
 * @typedef {Child}
 */
export class Child {
	/**
	 * The child process.
	 * @type {(ChildProcess | null)}
	 */
	public process: ChildProcess | null = null;
	/**
	 * The options for the child process.
	 * @type {(ForkOptions & { args?: string[] })}
	 */
	public processOptions: ForkOptions & { args?: string[] } = {};

	/**
	 * Creates an instance of Child.
	 * @constructor
	 * @param {string} file - The file to run.
	 * @param {ChildProcessOptions} options - The options for the child process.
	 */
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

	/**
	 * Spawns the child process.
	 * @returns {ChildProcess} The child process.
	 */
	public spawn(): ChildProcess {
		this.process = fork(this.file, this.processOptions.args, this.processOptions);
		return this.process;
	}

	/**
	 * Respawns the child process.
	 * @returns {ChildProcess} The child process.
	 */
	public async respawn(): Promise<ChildProcess> {
		await this.kill();
		return this.spawn();
	}

	/**
	 * Kills the child process.
	 * @returns {Promise<boolean>} If the child process was killed.
	 */
	public async kill(): Promise<boolean> {
		// @ts-ignore
		this.process?.removeAllListeners();
		return new Promise<boolean>((resolve) => {
			try {
				process.kill(this.process?.pid as number, 'SIGKILL');
				resolve(true);
			} catch (error) {
				console.error('Worker termination failed.');
				throw error;
			}
		});
	}

	/**
	 * Sends a message to the child process.
	 * @template {Serializable} T - The type of the message.
	 * @param {SerializableInput<T, true>} message - The message to send.
	 * @returns {Promise<void>} The promise.
	 */
	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.process?.send(message as object, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}
}

/**
 * Child client class.
 * @export
 * @class ChildClient
 * @typedef {ChildClient}
 */
export class ChildClient {
	/**
	 * The IPC process.
	 * @readonly
	 * @type {NodeJS.Process}
	 */
	readonly ipc: NodeJS.Process;

	/**
	 * Creates an instance of ChildClient.
	 * @constructor
	 */
	constructor() {
		this.ipc = process;
	}

	/**
	 * Sends a message to the child process.
	 * @template {Serializable} T - The type of the message.
	 * @param {SerializableInput<T, true>} message - The message to send.
	 * @returns {Promise<void>} The promise.
	 */
	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.ipc.send?.(message, (err: Error | null) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	/**
	 * Gets the data of the child process.
	 * @returns {NodeJS.ProcessEnv} The data.
	 */
	public getData(): NodeJS.ProcessEnv {
		return this.ipc.env;
	}
}
