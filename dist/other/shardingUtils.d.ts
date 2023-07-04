export default class ShardingUtils {
    static generateNonce(): string;
    static chunkArray<T>(array: T[], chunkSize: number): T[][];
    static delayFor(ms: number): Promise<void>;
    static makePlainError(err: Error): {
        name: string;
        message: string;
        stack: string | undefined;
    };
    static mergeObjects<T extends object>(main: Partial<T>, toMerge: Partial<T>): T;
    static shardIdForGuildId(guildId: string, totalShards: number): number;
    static clusterIdForShardId(shardId: string, totalShards: number, totalClusters: number): number;
    static clusterIdForGuildId(guildId: string, totalShards: number, totalClusters: number): number;
    static getRecommendedShards(token: string, guildsPerShard?: number): Promise<number>;
}
