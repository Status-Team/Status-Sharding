/// <reference types="node" />
/// <reference types="node" />
import { ChildProcess, ForkOptions, Serializable } from 'child_process';
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
    send(message: Serializable): Promise<void>;
}
export declare class ChildClient {
    readonly ipc: NodeJS.Process;
    constructor();
    send(message: Serializable): Promise<void>;
    getData(): NodeJS.ProcessEnv;
}
