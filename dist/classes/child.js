"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChildClient = exports.Child = void 0;
const child_process_1 = require("child_process");
class Child {
    file;
    process = null;
    processOptions = {};
    constructor(file, options) {
        this.file = file;
        this.processOptions = {};
        this.processOptions = {
            ...this.processOptions,
            cwd: options.cwd,
            detached: options.detached,
            execArgv: options.execArgv,
            env: options.clusterData || options.env,
            execPath: options.execPath,
            gid: options.gid,
            serialization: options.serialization,
            signal: options.signal,
            killSignal: options.killSignal,
            silent: options.silent,
            stdio: options.stdio,
            uid: options.uid,
            windowsVerbatimArguments: options.windowsVerbatimArguments,
            timeout: options.timeout,
            args: options.args,
        };
    }
    spawn() {
        this.process = (0, child_process_1.fork)(this.file, this.processOptions.args, this.processOptions);
        return this.process;
    }
    respawn() {
        this.kill();
        return this.spawn();
    }
    kill() {
        this.process?.removeAllListeners();
        return this.process?.kill();
    }
    send(message) {
        return new Promise((resolve, reject) => {
            this.process?.send(message, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
}
exports.Child = Child;
class ChildClient {
    ipc;
    constructor() {
        this.ipc = process;
    }
    send(message) {
        return new Promise((resolve, reject) => {
            this.ipc.send?.(message, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    getData() {
        return this.ipc.env;
    }
}
exports.ChildClient = ChildClient;
//# sourceMappingURL=child.js.map