import { ShardingUtils } from '../other/shardingUtils';
import { QueueOptions } from '../types';

/** Item of the queue. */
export interface QueueItem<A = unknown[]> {
    /** Runs the item. */
	run(...args: unknown[]): Promise<unknown>;
    /** Arguments to pass to the item. */
	args: A;
    /** Time when the item was added to the queue. */
	time?: number;
    /** Time to wait until next item. */
	timeout: number;
}

/** Queue class. */
export class Queue {
	/** Whether the queue is paused. */
	private paused: boolean = false;
	/** List of items in the queue. */
	private queue: QueueItem[] = [];

	/** Creates an instance of Queue. */
	constructor(public options: QueueOptions) {}

	/** Starts the queue and run's the item functions. */
	public async start(): Promise<Queue> {
		if (this.options.mode !== 'auto') {
			return new Promise((resolve) => {
				const interval = setInterval(() => {
					if (this.queue.length === 0) {
						clearInterval(interval);
						resolve(this); // Queue successfully finished.
					}
				}, 200);
			});
		}

		const length = this.queue.length;

		for (let i = 0; i < length; i++) {
			if (!this.queue[0]) continue;
			const timeout = this.queue[0].timeout;
			await this.next(); await ShardingUtils.delayFor(timeout);
		}

		return this;
	}

	/** Runs the next item in the queue. */
	public async next(): Promise<unknown> {
		if (this.paused) return;
		const item = this.queue.shift();

		if (!item) return true;
		return item.run(...item.args);
	}

	/** Stops the queue. */
	public stop(): this {
		this.paused = true;
		return this;
	}

	/** Resumes the queue. */
	public resume(): this {
		this.paused = false;
		return this;
	}

	/** Adds an item to the queue. */
	public add(item: QueueItem): this {
		this.queue.push({
			run: item.run,
			args: item.args,
			time: Date.now(),
			timeout: item.timeout ?? this.options.timeout,
		});

		return this;
	}
}
