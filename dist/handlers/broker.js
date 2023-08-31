"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPCBroker = void 0;
class IPCBroker {
    instance;
    listeners = new Map();
    constructor(instance) {
        this.instance = instance;
    }
    async send(channelName, message) {
        return this.instance.broker.handleMessage({ _data: message, broker: channelName });
    }
    listen(channelName, callback) {
        const listeners = this.listeners.get(channelName) ?? [];
        listeners.push(callback);
        this.listeners.set(channelName, listeners);
    }
    handleMessage({ _data, broker }) {
        if (!_data || !broker)
            return;
        const listeners = this.listeners.get(broker);
        if (!listeners)
            return;
        for (const listener of listeners) {
            listener(_data);
        }
    }
}
exports.IPCBroker = IPCBroker;
//# sourceMappingURL=broker.js.map