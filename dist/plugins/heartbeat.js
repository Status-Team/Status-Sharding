"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeartbeatManager = void 0;
const types_1 = require("../types");
class HeartbeatManager {
    manager;
    interval;
    beats;
    constructor(manager) {
        this.manager = manager;
        this.beats = new Map();
        this.interval = setInterval(() => {
            for (const cluster of this.manager.clusters.values()) {
                if (!cluster.ready)
                    continue;
                cluster._sendInstance({
                    _type: types_1.MessageTypes.Heartbeat,
                })?.catch(() => null);
            }
        }, this.manager.options.heartbeat.interval || 30000); // 30 seconds
    }
    stop() {
        clearInterval(this.interval);
    }
    getClusterStats(id) {
        return this.beats.get(id) || this.beats.set(id, { missedBeats: 0, restarts: 0 }).get(id);
    }
    removeCluster(id) {
        this.beats.delete(id);
    }
    addMissedBeat(id) {
        const cluster = this.getClusterStats(id);
        cluster.missedBeats++;
        if (cluster.missedBeats > this.manager.options.heartbeat.maxMissedHeartbeats) {
            this.manager.clusters.get(id)?.kill({ force: true });
            this.manager._debug(`Cluster ${id} has missed too many heartbeats. (${cluster.missedBeats})`);
            if (cluster.restarts < this.manager.options.heartbeat.maxRestarts) {
                this.manager._debug(`Cluster ${id} is restarting... (${this.manager.options.heartbeat.maxRestarts - cluster.restarts} left.)`);
                this.manager.clusters.get(id)?.spawn();
                cluster.missedBeats = 0;
                cluster.restarts++;
            }
            else
                this.manager._debug(`Cluster ${id} reached the maximum amount of restarts. (${cluster.restarts})`);
        }
        this.beats.set(id, cluster);
    }
}
exports.HeartbeatManager = HeartbeatManager;
//# sourceMappingURL=heartbeat.js.map