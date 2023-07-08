/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { Worker as WorkerThread, WorkerOptions, MessagePort } from 'worker_threads';
import { Serializable } from 'child_process';
export interface WorkerThreadOptions extends WorkerOptions {
    clusterData: NodeJS.ProcessEnv | undefined;
}
export declare class Worker {
    private file;
    process: WorkerThread | null;
    workerOptions: WorkerOptions;
    constructor(file: string, options: WorkerThreadOptions);
    spawn(): WorkerThread;
    respawn(): WorkerThread;
    kill(): Promise<number> | undefined;
    send(message: Serializable): Promise<void>;
}
export declare class WorkerClient {
    readonly ipc: MessagePort | null;
    constructor();
    send(message: Serializable): Promise<void>;
    getData(): unknown;
}
