"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessMessage = void 0;
const types_1 = require("../types");
class ProcessMessage {
    _instance;
    _nonce;
    data;
    constructor(instance, data) {
        this.data = data.data;
        this._nonce = data._nonce;
        this._instance = instance;
    }
    async reply(message) {
        return this._instance._sendInstance({
            data: message,
            _type: types_1.MessageTypes.CustomReply,
            _nonce: this._nonce,
        });
    }
}
exports.ProcessMessage = ProcessMessage;
//# sourceMappingURL=message.js.map