"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageTypes = exports.Endpoints = exports.DefaultOptions = void 0;
exports.DefaultOptions = {
    http: {
        api: 'https://discord.com/api',
        version: '10',
    },
};
exports.Endpoints = {
    botGateway: '/gateway/bot',
};
var MessageTypes;
(function (MessageTypes) {
    MessageTypes[MessageTypes["MissingType"] = 0] = "MissingType";
    MessageTypes[MessageTypes["CustomRequest"] = 1] = "CustomRequest";
    MessageTypes[MessageTypes["CustomMessage"] = 2] = "CustomMessage";
    MessageTypes[MessageTypes["CustomReply"] = 3] = "CustomReply";
    MessageTypes[MessageTypes["Heartbeat"] = 4] = "Heartbeat";
    MessageTypes[MessageTypes["HeartbeatAck"] = 5] = "HeartbeatAck";
    MessageTypes[MessageTypes["ClientBroadcast"] = 6] = "ClientBroadcast";
    MessageTypes[MessageTypes["ClientBroadcastRequest"] = 7] = "ClientBroadcastRequest";
    MessageTypes[MessageTypes["ClientBroadcastResponse"] = 8] = "ClientBroadcastResponse";
    MessageTypes[MessageTypes["ClientBroadcastResponseError"] = 9] = "ClientBroadcastResponseError";
    MessageTypes[MessageTypes["ClientRespawn"] = 10] = "ClientRespawn";
    MessageTypes[MessageTypes["ClientRespawnAll"] = 11] = "ClientRespawnAll";
    MessageTypes[MessageTypes["ClientMaintenance"] = 12] = "ClientMaintenance";
    MessageTypes[MessageTypes["ClientMaintenanceEnable"] = 13] = "ClientMaintenanceEnable";
    MessageTypes[MessageTypes["ClientMaintenanceDisable"] = 14] = "ClientMaintenanceDisable";
    MessageTypes[MessageTypes["ClientMaintenanceAll"] = 15] = "ClientMaintenanceAll";
    MessageTypes[MessageTypes["ClientSpawnNextCluster"] = 16] = "ClientSpawnNextCluster";
    MessageTypes[MessageTypes["ClientReady"] = 17] = "ClientReady";
    MessageTypes[MessageTypes["ClientEvalRequest"] = 18] = "ClientEvalRequest";
    MessageTypes[MessageTypes["ClientEvalResponse"] = 19] = "ClientEvalResponse";
    MessageTypes[MessageTypes["ClientEvalResponseError"] = 20] = "ClientEvalResponseError";
    MessageTypes[MessageTypes["ClientManagerEvalRequest"] = 21] = "ClientManagerEvalRequest";
    MessageTypes[MessageTypes["ClientManagerEvalResponse"] = 22] = "ClientManagerEvalResponse";
    MessageTypes[MessageTypes["ClientManagerEvalResponseError"] = 23] = "ClientManagerEvalResponseError";
})(MessageTypes || (exports.MessageTypes = MessageTypes = {}));
//# sourceMappingURL=types.js.map