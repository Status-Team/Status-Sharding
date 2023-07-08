"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerClient = exports.Worker = void 0;
const worker_threads_1 = require("worker_threads");
class Worker {
    file;
    process = null;
    workerOptions;
    constructor(file, options) {
        this.file = file;
        this.workerOptions = {
            workerData: options.clusterData,
            ...options,
        };
    }
    spawn() {
        return (this.process = new worker_threads_1.Worker(this.file, this.workerOptions));
    }
    respawn() {
        this.kill();
        return this.spawn();
    }
    kill() {
        this.process?.removeAllListeners();
        return this.process?.terminate();
    }
    send(message) {
        return new Promise((resolve) => {
            this.process?.postMessage(message);
            resolve();
        });
    }
}
exports.Worker = Worker;
class WorkerClient {
    ipc;
    constructor() {
        this.ipc = worker_threads_1.parentPort;
    }
    send(message) {
        return new Promise((resolve) => {
            this.ipc?.postMessage(message);
            resolve();
        });
    }
    getData() {
        return worker_threads_1.workerData;
    }
}
exports.WorkerClient = WorkerClient;
//# sourceMappingURL=worker.js.map