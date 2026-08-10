export class ListenerManager {
	private readonly cleanups = new Set<() => void>();

	public listen(target: {
		on(event: string | symbol, listener: (...args: unknown[]) => void): unknown;
		removeListener?: (event: string | symbol, listener: (...args: unknown[]) => void) => unknown;
	}, event: string | symbol, listener: (...args: unknown[]) => void): void {
		target.on(event, listener);
		this.cleanups.add(() => target.removeListener?.(event, listener));
	}

	public clear(): void {
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.clear();
	}
}
