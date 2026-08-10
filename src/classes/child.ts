import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface ChildProcessDiagnostic {
	pid: number | null;
	alive: boolean;
	connected: boolean;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	osState?: string;
	uninterruptible: boolean;
}

export interface ChildProcessOptions extends ForkOptions {
	clusterData?: Record<string, string | number | boolean>;
	args?: string[];

	terminationTimeout?: number;
	forceKillAfter?: number;
	ipcTimeout?: number;
	ipcMaxPayload?: number;
}

export interface ChildClientOptions {
	ipcTimeout?: number;
	ipcMaxPayload?: number;
}

interface TerminationOperation<T> {
	target: T;
	promise: Promise<boolean>;
}

export class Child {
	public process: ChildProcess | null = null;
	public readonly processOptions: ForkOptions & { args?: string[] };

	private readonly terminationTimeout: number;
	private readonly forceKillAfter: number;
	private readonly ipcTimeout: number;
	private readonly ipcMaxPayload: number;

	private readonly debugEmitter?: (message: string) => void;
	private terminationOperation?: TerminationOperation<ChildProcess>;

	constructor (private readonly file: string, options: ChildProcessOptions, debugEmitter?: (message: string) => void) {
		this.terminationTimeout = options.terminationTimeout ?? 15_000;
		this.ipcMaxPayload = options.ipcMaxPayload ?? 8 * 1024 * 1024;
		this.ipcTimeout = options.ipcTimeout ?? 30_000;

		this.forceKillAfter = Math.min(options.forceKillAfter ?? 5_000, Math.max(0, this.terminationTimeout - 100));
		this.debugEmitter = debugEmitter;

		this.processOptions = {
			cwd: options.cwd,
			detached: options.detached ?? false,
			execArgv: options.execArgv,
			args: options.args,
			env: options.env,
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
		};
	}

	/* ----------------------------------- Lifecycle ----------------------------------- */

	public isAlive(target: ChildProcess | null = this.process): boolean {
		return Boolean(target && target.exitCode === null && target.signalCode === null);
	}

	public isUsable(target: ChildProcess | null = this.process): boolean {
		if (!target || !this.isAlive(target)) return false;

		return target.connected === true && typeof target.send === 'function';
	}

	public diagnose(target: ChildProcess | null = this.process): ChildProcessDiagnostic {
		const pid = target ? target.pid ?? null : null;
		const osState = pid === null ? undefined : this.readProcessState(pid);

		return {
			pid,
			alive: this.isAlive(target),
			connected: target ? target.connected === true : false,
			exitCode: target ? target.exitCode : null,
			signalCode: target ? target.signalCode : null,
			uninterruptible: osState === 'D',
			osState,
		};
	}

	public spawn(): ChildProcess {
		const current = this.process;
		if (current && this.isUsable(current)) return current;

		if (this.isAlive()) {
			const pid = this.process ? this.process.pid : undefined;
			throw new Error(`CHILD_PROCESS_IPC_DISCONNECTED | Child PID ${pid ?? 'unknown'} is alive without IPC.`);
		}

		this.process = fork(this.file, this.processOptions.args, this.processOptions);
		const pid = this.process.pid;
		this.debug(`The child process${pid === undefined ? '' : ` with PID ${pid}`} was spawned.`);

		return this.process;
	}

	public async respawn(): Promise<ChildProcess> {
		if (!(await this.kill())) throw new Error('CHILD_PROCESS_TERMINATION_UNVERIFIED | Refusing to replace a live child.');
		return this.spawn();
	}

	public kill(): Promise<boolean> {
		const target = this.process;
		if (!target) {
			this.debug('A child termination was requested, but no child process is active.');
			return Promise.resolve(true);
		}

		const activeOperation = this.terminationOperation;
		if (activeOperation && activeOperation.target === target) return activeOperation.promise;
		this.debug(`A termination was requested for ${this.formatDiagnostic(target)}.`);

		const promise = this.killTarget(target).finally(() => {
			const currentOperation = this.terminationOperation;
			if (currentOperation && currentOperation.target === target) this.terminationOperation = undefined;
		});

		this.terminationOperation = { target, promise };

		return promise;
	}

	private killTarget(target: ChildProcess): Promise<boolean> {
		if (!this.isAlive(target)) {
			if (this.process === target) this.process = null;
			return Promise.resolve(true);
		}

		return new Promise<boolean>((resolve) => {
			let settled = false;
			let forceTimer: NodeJS.Timeout | undefined;
			let hardTimer: NodeJS.Timeout | undefined;

			const finish = (success: boolean) => {
				if (settled) return;
				settled = true;

				if (forceTimer) clearTimeout(forceTimer);
				if (hardTimer) clearTimeout(hardTimer);

				target.removeListener('exit', onExit);
				target.removeListener('error', onError);

				if (success && this.process === target) this.process = null;
				this.debug(success ? `Termination was verified for ${this.formatDiagnostic(target)}.` : `Termination could not be verified for ${this.formatDiagnostic(target)}.`);

				resolve(success);
			};

			const onExit = () => finish(true);
			const onError = () => {
				if (!this.isAlive(target)) finish(true);
			};

			target.once('exit', onExit);
			target.on('error', onError);

			forceTimer = setTimeout(() => {
				if (this.isAlive(target)) {
					this.debug(`The child did not exit after SIGTERM, so SIGKILL escalation is starting for ${this.formatDiagnostic(target)}.`);

					const forced = this.forceKill(target);
					if (!forced && this.isAlive(target)) finish(false);
				}
			}, this.forceKillAfter);

			hardTimer = setTimeout(() => {
				if (this.isAlive(target)) this.debug(`The child did not terminate before the ${this.terminationTimeout} millisecond deadline and may be unkillable; ${this.formatDiagnostic(target)}.`);
				finish(!this.isAlive(target));
			}, this.terminationTimeout);

			try {
				this.debug(`SIGTERM is being sent to ${this.formatDiagnostic(target)}.`);
				target.kill('SIGTERM');
			} catch {
				if (!this.isAlive(target)) finish(true);
				else if (!this.forceKill(target)) finish(false);
			}
		});
	}

	private forceKill(target: ChildProcess): boolean {
		let attempted = false;
		let firstError: unknown;

		try {
			this.debug(`SIGKILL is being sent through ChildProcess to ${this.formatDiagnostic(target)}.`);
			attempted = target.kill('SIGKILL');
		} catch (error) {
			firstError = error;
			this.debug(`ChildProcess SIGKILL failed with ${error instanceof Error ? error.message : String(error)}.`);
		}

		if (target.pid && this.isAlive(target)) {
			try {
				this.debug(`SIGKILL is being sent through process.kill to PID ${target.pid}.`);
				process.kill(target.pid, 'SIGKILL');
				attempted = true;
			} catch (error: unknown) {
				firstError ??= error;
				this.debug(`process.kill SIGKILL failed with ${error instanceof Error ? error.message : String(error)}.`);
			}
		}

		if (this.isAlive(target) && !attempted && firstError !== undefined) return false;
		return true;
	}

	private readProcessState(pid: number): string | undefined {
		if (process.platform !== 'linux') return undefined;

		try {
			const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
			const closeParen = stat.lastIndexOf(')');

			return closeParen >= 0 ? stat.slice(closeParen + 2, closeParen + 3) : undefined;
		} catch {
			return undefined;
		}
	}

	private formatDiagnostic(target: ChildProcess): string {
		const diagnostic = this.diagnose(target);
		const pid = diagnostic.pid ?? 'an unknown PID';
		const processState = diagnostic.alive ? 'alive' : 'not alive';
		const ipcState = diagnostic.connected ? 'an open IPC channel' : 'a closed IPC channel';
		const osState = diagnostic.osState ?? 'an unknown Linux state';

		return `the child process with PID ${pid} is ${processState}, has ${ipcState}, and reports ${osState}`;
	}

	private debug(message: string): void {
		const emitter = this.debugEmitter;
		if (emitter) emitter(message);
	}

	/* ----------------------------------- IPC ----------------------------------- */

	public send<T extends object>(message: T): Promise<void> {
		const target = this.process;
		if (!target || !this.isUsable(target)) return Promise.reject(new Error('CHILD_PROCESS_UNAVAILABLE | Child IPC is unavailable.'));

		if (JSON.stringify(message).length > this.ipcMaxPayload) return Promise.reject(new Error('IPC_PAYLOAD_TOO_LARGE | IPC payload exceeds the configured limit.'));

		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;

				reject(new Error(`IPC_SEND_TIMEOUT | Child PID ${target.pid ?? 'unknown'} did not accept the message.`));
			}, this.ipcTimeout);

			try {
				this.debug(`An IPC message containing ${JSON.stringify(message).length} bytes is being sent to child PID ${target.pid ?? 'unknown'}.`);
				target.send(message, (error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					if (error) reject(error);
					else resolve();
				});
			} catch (error: unknown) {
				clearTimeout(timer);
				if (!settled) {
					settled = true;
					reject(error);
				}
			}
		});
	}
}

export class ChildClient {
	public readonly ipc: NodeJS.Process = process;

	private disconnected = false;
	private readonly ipcTimeout: number;
	private readonly ipcMaxPayload: number;

	constructor (options: ChildClientOptions = {}) {
		this.ipcTimeout = options.ipcTimeout ?? 30_000;
		this.ipcMaxPayload = options.ipcMaxPayload ?? 8 * 1024 * 1024;
		
		this.ipc.once('disconnect', () => {
			this.disconnected = true;
			process.exitCode = 1;

			const timer = setTimeout(() => process.exit(1), 1_000);
			timer.unref();
		});
	}

	public send<T extends object>(message: T): Promise<void> {
		if (this.disconnected || !this.ipc.connected || typeof this.ipc.send !== 'function') return Promise.reject(new Error('IPC_CHANNEL_CLOSED | Parent IPC channel is unavailable.'));

		if (JSON.stringify(message).length > this.ipcMaxPayload) return Promise.reject(new Error('IPC_PAYLOAD_TOO_LARGE | IPC payload exceeds the configured limit.'));
		return new Promise<void>((resolve, reject) => {
			let settled = false;

			const timer = setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new Error('IPC_SEND_TIMEOUT | Parent IPC send timed out.'));
				}
			}, this.ipcTimeout);

			try {
				const send = this.ipc.send;
				if (!send) {
					reject(new Error('IPC_CHANNEL_CLOSED | Parent IPC send is unavailable.'));
					return;
				}

				send.call(this.ipc, message, (error) => {
					if (settled) return;
					settled = true;

					clearTimeout(timer);

					if (error) reject(error);
					else resolve();
				});
			} catch (error: unknown) {
				clearTimeout(timer);
				if (!settled) {
					settled = true;
					reject(error);
				}
			}
		});
	}
}
