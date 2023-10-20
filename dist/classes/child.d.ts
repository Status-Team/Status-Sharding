/// <reference types="node" />
/// <reference types="node" />
import { ChildProcess, ForkOptions } from 'child_process';
import { SerializableInput, Serializable } from '../types';
export interface ChildProcessOptions extends ForkOptions {
    clusterData: NodeJS.ProcessEnv | undefined;
    args?: string[] | undefined;
}
export declare class Child {
    private file;
    process: ChildProcess | null;
    processOptions: ForkOptions & {
        args?: string[];
    };
    constructor(file: string, options: ChildProcessOptions);
    spawn(): ChildProcess;
    respawn(): ChildProcess;
    kill(): boolean | undefined;
    send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void>;
}
export declare class ChildClient {
    readonly ipc: NodeJS.Process;
    constructor();
    send<T extends Serializable>(message: SerializableInput<T, true>): Promise<void>;
    getData(): NodeJS.ProcessEnv;
}
