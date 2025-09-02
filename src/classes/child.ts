import { ChildProcessEventMap, ListenerManager } from './listen';
import { ChildProcess, fork, ForkOptions } from 'child_process';
import { SerializableInput, Serializable } from '../types';

export interface ChildProcessOptions extends ForkOptions {
	/** Data to send to the cluster. */
	clusterData?: NodeJS.ProcessEnv | undefined;
	/** The arguments to pass to the child process. */
	args?: string[] | undefined;
}

export class Child {
	/** The child process. */
	public process: ChildProcess | null = null;
	/** The options for the child process. */
	public processOptions: ForkOptions & { args?: string[] } = {};

	/** Type-safe listener manager */
	private _listeners = new ListenerManager<ChildProcessEventMap>();

	/** Creates an instance of Child. */
	constructor (private file: string, options: ChildProcessOptions) {
		this.processOptions = {
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
		if (this.process && !this.process.killed) return this.process;

		this.process = fork(this.file, this.processOptions.args, this.processOptions);
		return this.process;
	}

	/** Respawns the child process. */
	public async respawn(): Promise<ChildProcess> {
		await this.kill();
		return this.spawn();
	}

	/** Kills the child process with proper cleanup. */
	public async kill(): Promise<boolean> {
		if (!this.process || !this.process.pid || this.process.killed) return false;

		try {
			const forceKillTimer = setTimeout(() => {
				if (this.process && !this.process.killed) {
					console.warn('Force killing process with SIGKILL.');
					this.process.kill('SIGKILL');
				}
			}, 5000);

			return new Promise<boolean>((resolve) => {
				if (!this.process || this.process.killed) {
					clearTimeout(forceKillTimer);
					this._cleanup();
					resolve(false);
					return;
				}

				const cleanup = () => {
					clearTimeout(forceKillTimer);
					this._cleanup();
				};

				const onExit = () => {
					cleanup();
					resolve(true);
				};

				const onError = (err: Error) => {
					console.error('Error during child process kill:', err);
					cleanup();
					resolve(false);
				};

				this.process.removeAllListeners('exit');
				this.process.removeAllListeners('error');

				this.process.once('exit', onExit);
				this.process.once('error', onError);

				this.process.kill('SIGTERM');
			});
		} catch (error) {
			console.error('Child termination failed:', error);
			this._cleanup();
			return false;
		}
	}

	/** Clean up process and listeners */
	private _cleanup(): void {
		if (this.process) this.process.removeAllListeners();
		this._listeners.clear();
		this.process = null;
	}

	/** Sends a message to the child process. */
	public send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.process || this.process.killed) {
				reject(new Error('No active process to send message to'));
				return;
			}

			this.process.send(message as object, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	/** Add event listener with proper cleanup tracking */
	public addListener<K extends keyof ChildProcessEventMap>(event: K, listener: ChildProcessEventMap[K]): void {
		if (!this.process) return;

		const existingListener = this._listeners.get(event);
		if (existingListener) this.process.removeListener(event, existingListener);

		this._listeners.set(event, listener);
		this.process.on(event, listener);
	}

	/** Remove specific event listener */
	public removeListener<K extends keyof ChildProcessEventMap>(event: K): void {
		const listener = this._listeners.get(event);
		if (this.process && listener) {
			this.process.removeListener(event, listener);
			this._listeners.delete(event);
		}
	}

	/** Get current listener for an event */
	public getListener<K extends keyof ChildProcessEventMap>(event: K): ChildProcessEventMap[K] | undefined {
		return this._listeners.get(event);
	}

	/** Check if listener exists for event */
	public hasListener<K extends keyof ChildProcessEventMap>(event: K): boolean {
		return this._listeners.has(event);
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
			this.ipc.send?.(message, (err: Error | null) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}
}
