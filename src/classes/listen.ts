export interface ChildProcessEventMap {
	exit: (code: number | null, signal: NodeJS.Signals | null) => void;
	error: (error: Error) => void;
	message: (message: unknown, sendHandle?: unknown) => void;
	disconnect: () => void;
	close: (code: number | null, signal: NodeJS.Signals | null) => void;
	spawn: () => void;
}

export interface WorkerThreadEventMap {
	exit: (exitCode: number) => void;
	error: (error: Error) => void;
	message: (value: unknown) => void;
	messageerror: (error: Error) => void;
	online: () => void;
}

/** Generic listener manager for type safety */
export class ListenerManager<T extends WorkerThreadEventMap | ChildProcessEventMap> {
	private listeners = new Map<keyof T, T[keyof T]>();

	set<K extends keyof T>(event: K, listener: T[K]): void {
		this.listeners.set(event, listener);
	}

	get<K extends keyof T>(event: K): T[K] | undefined {
		return this.listeners.get(event) as T[K] | undefined;
	}

	has<K extends keyof T>(event: K): boolean {
		return this.listeners.has(event);
	}

	delete<K extends keyof T>(event: K): boolean {
		return this.listeners.delete(event);
	}

	clear(): void {
		this.listeners.clear();
	}
}
