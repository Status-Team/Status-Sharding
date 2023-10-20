import { ChildProcess, fork, ForkOptions } from 'child_process';
import { SerializableInput, Serializable } from '../types';

export interface ChildProcessOptions extends ForkOptions {
	clusterData: NodeJS.ProcessEnv | undefined;
	args?: string[] | undefined;
}

export class Child {
	public process: ChildProcess | null = null;
	public processOptions: ForkOptions & { args?: string[] } = {};

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

	public spawn() {
		this.process = fork(this.file, this.processOptions.args, this.processOptions);
		return this.process;
	}

	public respawn() {
		this.kill();
		return this.spawn();
	}

	public kill() {
		this.process?.removeAllListeners();
		return this.process?.kill();
	}

	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.process?.send(message as object, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}
}

export class ChildClient {
	readonly ipc: NodeJS.Process;

	constructor() {
		this.ipc = process;
	}

	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.ipc.send?.(message, (err: Error | null) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	public getData(): NodeJS.ProcessEnv {
		return this.ipc.env;
	}
}
