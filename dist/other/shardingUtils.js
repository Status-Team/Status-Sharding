"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShardingUtils = void 0;
const types_1 = require("../types");
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
class ShardingUtils {
    static generateNonce() {
        let randomStr = '';
        do {
            randomStr += characters.charAt(Math.floor(Math.random() * characters.length));
        } while (randomStr.length < 10);
        return randomStr;
    }
    static chunkArray(array, chunkSize) {
        const R = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            R.push(array.slice(i, i + chunkSize));
        }
        return R;
    }
    static delayFor(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
    static makePlainError(err) {
        return {
            name: err.name,
            message: err.message,
            stack: err.stack,
        };
    }
    static mergeObjects(main, toMerge) {
        for (const key in toMerge) {
            if (toMerge[key] && typeof toMerge[key] === 'object') {
                if (!main[key])
                    Object.assign(main, { [key]: {} });
                this.mergeObjects(main[key], toMerge[key]);
            }
            else {
                Object.assign(main, { [key]: toMerge[key] });
            }
        }
        return main;
    }
    static shardIdForGuildId(guildId, totalShards) {
        if (!guildId?.match(/^[0-9]+$/))
            throw new Error('No valid GuildId Provided.');
        if (isNaN(totalShards) || totalShards < 1)
            throw new Error('No valid TotalShards Provided.');
        const shard = Number(BigInt(guildId) >> BigInt(22)) % totalShards;
        if (shard < 0)
            throw new Error('SHARD_MISCALCULATION_SHARDID_SMALLER_THAN_0 ' + `Calculated Shard: ${shard}, guildId: ${guildId}, totalShards: ${totalShards}`);
        return shard;
    }
    static clusterIdForShardId(shardId, totalShards, totalClusters) {
        if (!shardId?.match(/^[0-9]+$/))
            throw new Error('No valid ShardId Provided.');
        if (isNaN(totalShards) || totalShards < 1)
            throw new Error('No valid TotalShards Provided.');
        if (isNaN(totalClusters) || totalClusters < 1)
            throw new Error('No valid TotalClusters Provided.');
        const middlePart = Number(shardId) === 0 ? 0 : Number(shardId) / Math.ceil(totalShards / totalClusters);
        return Number(shardId) === 0 ? 0 : (Math.ceil(middlePart) - (middlePart % 1 !== 0 ? 1 : 0));
    }
    static clusterIdForGuildId(guildId, totalShards, totalClusters) {
        if (!guildId?.match(/^[0-9]+$/))
            throw new Error('No valid GuildId Provided.');
        if (isNaN(totalShards) || totalShards < 1)
            throw new Error('No valid TotalShards Provided.');
        if (isNaN(totalClusters) || totalClusters < 1)
            throw new Error('No valid TotalClusters Provided.');
        const shardId = this.shardIdForGuildId(guildId, totalShards);
        return this.clusterIdForShardId(shardId.toString(), totalShards, totalClusters);
    }
    static async getRecommendedShards(token, guildsPerShard = 1000) {
        if (!token)
            throw new Error('DISCORD_TOKEN_MISSING | No token was provided to ClusterManager options.');
        const response = await fetch(`${types_1.DefaultOptions.http.api}/v${types_1.DefaultOptions.http.version}${types_1.Endpoints.botGateway}`, {
            method: 'GET',
            headers: { Authorization: `Bot ${token.replace(/^Bot\s*/i, '')}` },
        }).then((res) => {
            if (res.ok)
                return res.json();
            if (res.status === 401)
                throw new Error('DISCORD_TOKEN_INVALID | The provided token was invalid.');
            throw res;
        });
        return response.shards * (1000 / guildsPerShard);
    }
}
exports.ShardingUtils = ShardingUtils;
//# sourceMappingURL=shardingUtils.js.map