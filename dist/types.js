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
    MessageTypes[MessageTypes["ClientBroadcastRequest"] = 6] = "ClientBroadcastRequest";
    MessageTypes[MessageTypes["ClientBroadcastResponse"] = 7] = "ClientBroadcastResponse";
    MessageTypes[MessageTypes["ClientBroadcastResponseError"] = 8] = "ClientBroadcastResponseError";
    MessageTypes[MessageTypes["ClientRespawn"] = 9] = "ClientRespawn";
    MessageTypes[MessageTypes["ClientRespawnAll"] = 10] = "ClientRespawnAll";
    MessageTypes[MessageTypes["ClientMaintenance"] = 11] = "ClientMaintenance";
    MessageTypes[MessageTypes["ClientMaintenanceEnable"] = 12] = "ClientMaintenanceEnable";
    MessageTypes[MessageTypes["ClientMaintenanceDisable"] = 13] = "ClientMaintenanceDisable";
    MessageTypes[MessageTypes["ClientMaintenanceAll"] = 14] = "ClientMaintenanceAll";
    MessageTypes[MessageTypes["ClientSpawnNextCluster"] = 15] = "ClientSpawnNextCluster";
    MessageTypes[MessageTypes["ClientReady"] = 16] = "ClientReady";
    MessageTypes[MessageTypes["ClientEvalRequest"] = 17] = "ClientEvalRequest";
    MessageTypes[MessageTypes["ClientEvalResponse"] = 18] = "ClientEvalResponse";
    MessageTypes[MessageTypes["ClientEvalResponseError"] = 19] = "ClientEvalResponseError";
    MessageTypes[MessageTypes["ClientManagerEvalRequest"] = 20] = "ClientManagerEvalRequest";
    MessageTypes[MessageTypes["ClientManagerEvalResponse"] = 21] = "ClientManagerEvalResponse";
    MessageTypes[MessageTypes["ClientManagerEvalResponseError"] = 22] = "ClientManagerEvalResponseError";
    MessageTypes[MessageTypes["ManagerBroadcastRequest"] = 23] = "ManagerBroadcastRequest";
    MessageTypes[MessageTypes["ManagerBroadcastResponse"] = 24] = "ManagerBroadcastResponse";
})(MessageTypes || (exports.MessageTypes = MessageTypes = {}));
//# sourceMappingURL=types.js.map