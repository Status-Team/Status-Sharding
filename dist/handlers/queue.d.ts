import { QueueOptions } from '../types';
export interface QueueItem {
    run(...args: unknown[]): Promise<unknown>;
    args: unknown[];
    time?: number;
    timeout: number;
}
export declare class Queue {
    options: QueueOptions;
    private paused;
    private queue;
    constructor(options: QueueOptions);
    start(): Promise<Queue>;
    next(): Promise<unknown>;
    stop(): this;
    resume(): this;
    add(item: QueueItem): this;
}
