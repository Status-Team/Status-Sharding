"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromiseHandler = void 0;
const types_1 = require("../types");
class PromiseHandler {
    nonces = new Map();
    resolve(message) {
        const promise = this.nonces.get(message._nonce);
        if (!promise)
            throw new Error(`No promise found with nonce ${message._nonce}.`);
        if (promise.timeout)
            clearTimeout(promise.timeout);
        this.nonces.delete(message._nonce);
        if (message._type !== types_1.MessageTypes.ClientEvalResponseError)
            promise.resolve(message.data);
        else {
            const error = new Error(message.data.message);
            error.stack = message.data.stack;
            error.name = message.data.name;
            promise.reject(error);
        }
    }
    async create(nonce, timeout) {
        return await new Promise((resolve, reject) => {
            if (!timeout)
                this.nonces.set(nonce, { resolve, reject });
            else
                this.nonces.set(nonce, { resolve, reject, timeout: setTimeout(() => { this.nonces.delete(nonce); reject(new Error('Promise timed out.')); }, timeout) });
        });
    }
}
exports.PromiseHandler = PromiseHandler;
//# sourceMappingURL=promise.js.map