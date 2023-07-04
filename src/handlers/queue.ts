import ShardingUtils from '../other/shardingUtils';
import { QueueOptions } from '../types';

export interface QueueItem {
    run(...args: unknown[]): Promise<unknown>;
    args: unknown[];
    time?: number;
    timeout: number;
}

export class Queue {
	private paused = false;
	private queue: QueueItem[] = [];

	constructor(public options: QueueOptions) {}

	// Starts the queue and run's the item functions.
	public async start(): Promise<Queue> {
		if (!this.options.auto) {
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

	// Runs the next item in the queue.
	public async next() {
		if (this.paused) return;
		const item = this.queue.shift();

		if (!item) return true;
		return item.run(...item.args);
	}

	// Stop's the queue and blocks the next item from running.
	public stop() {
		this.paused = true;
		return this;
	}

	// Resume's the queue and allows the next item to run.
	public resume() {
		this.paused = false;
		return this;
	}

	// Adds an item to the queue.
	public add(item: QueueItem) {
		this.queue.push({
			run: item.run,
			args: item.args,
			time: Date.now(),
			timeout: item.timeout ?? this.options.timeout,
		});

		return this;
	}
}
