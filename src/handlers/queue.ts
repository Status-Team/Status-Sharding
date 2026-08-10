import { ShardingUtils } from '../other/shardingUtils.js';

interface QueueItem<T> {
	work: () => Promise<T>;
	resolve(value: T): void;
	reject: (error: Error) => void;
}

export class Queue {
	private readonly items: QueueItem<unknown>[] = [];
	private running = false;
	private stopped = false;
	private activeItem?: QueueItem<unknown>;

	constructor (private readonly options: { mode: 'auto' | 'manual'; delay: number; timeout: number }) { }

	public get size(): number {
		return this.items.length;
	}

	public get active(): boolean {
		return this.running;
	}

	public add<T>(work: () => Promise<T>): Promise<T> {
		if (this.stopped) return Promise.reject(new Error('QUEUE_STOPPED | Queue has been stopped.'));

		const promise = new Promise<T>((resolve, reject) => {
			this.items.push({
				work, reject,
				resolve(value: T): void {
					resolve(value);
				},
			});
		});

		if (this.options.mode === 'auto') void this.start();
		return promise;
	}

	public async start(): Promise<void> {
		if (this.running || this.stopped) return;
		this.running = true;

		try {
			while (!this.stopped && this.items.length) {
				const item = this.items.shift();
				if (!item) break;
				this.activeItem = item;
				let timer: NodeJS.Timeout | undefined;

				try {
					const timeout = new Promise<unknown>((_, reject) => {
						timer = setTimeout(() => reject(new Error('QUEUE_TIMEOUT | Queue item timed out.')), this.options.timeout);
					});

					const value = await Promise.race([item.work(), timeout]);
					item.resolve(value);
				} catch (error: unknown) {
					item.reject(error instanceof Error ? error : new Error(String(error)));
				} finally {
					if (timer) clearTimeout(timer);
					this.activeItem = undefined;
				}

				if (this.items.length && this.options.delay) await ShardingUtils.delayFor(this.options.delay);
			}
		} finally {
			this.running = false;
			if (!this.stopped && this.items.length) void this.start();
		}
	}

	public next(): Promise<void> {
		return this.start();
	}

	public resume(): Promise<void> {
		this.stopped = false;
		return this.start();
	}

	public stop(error = new Error('QUEUE_STOPPED | Queue has been stopped.')): void {
		this.stopped = true;
		if (this.activeItem) this.activeItem.reject(error);
		for (const item of this.items.splice(0)) item.reject(error);
	}
}
