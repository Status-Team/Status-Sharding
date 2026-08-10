export class PromiseHandler {
	private readonly pending = new Map<
		string,
		{ timer: NodeJS.Timeout; resolve(value: unknown): void; reject: (error: Error) => void }
	>();

	constructor (private readonly defaultTimeout = 30_000, private readonly maxPending = 10_000) { }

	public create<T>(nonce: string, timeout = this.defaultTimeout): Promise<T> {
		if (this.pending.has(nonce)) throw new Error('IPC_NONCE_DUPLICATE | A request with this nonce is already pending.');
		if (this.pending.size >= this.maxPending) throw new Error('IPC_PENDING_LIMIT | Too many pending IPC requests.');

		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(nonce);
				reject(new Error(`IPC_TIMEOUT | Request ${nonce} timed out.`));
			}, timeout);

			this.pending.set(nonce, {
				timer,
				resolve(value: T): void {
					resolve(value);
				},
				reject,
			});
		});
	}

	public resolve<T>(nonce: string, value: T): boolean {
		const entry = this.pending.get(nonce);
		if (!entry) return false;

		clearTimeout(entry.timer);
		this.pending.delete(nonce);
		entry.resolve(value);
		return true;
	}

	public reject(nonce: string, error: Error): boolean {
		const entry = this.pending.get(nonce);
		if (!entry) return false;

		clearTimeout(entry.timer);
		this.pending.delete(nonce);
		entry.reject(error);

		return true;
	}

	public rejectAll(error: Error): void {
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		
		this.pending.clear();
	}

	public rejectMatching(predicate: (nonce: string) => boolean, error: Error): void {
		for (const [nonce, entry] of this.pending) {
			if (!predicate(nonce)) continue;
			clearTimeout(entry.timer);
			this.pending.delete(nonce);
			entry.reject(error);
		}
	}
}
