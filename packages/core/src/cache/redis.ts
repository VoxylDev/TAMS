import Redis from 'ioredis';
import { AbstractionDepth, log } from '@tams/common';

import type {
    RedisConfig,
    MemoryContext,
    ContextLayer,
    STMEntry,
    STMConfig,
    PromptEntry
} from '@tams/common';

/** Default time-to-live for cached context entries (1 hour). */
const DEFAULT_TTL = 3600;

/** Prefix for all TAMS keys in Redis. */
const DEFAULT_PREFIX = 'tams';

/** Default STM configuration values. */
const DEFAULT_STM: STMConfig = {
    maxEntries: 5,
    maxTailChars: 2000,
    ttl: 7200,
    maxPrompts: 10
};

/**
 * Redis cache layer for the TAMS hot retrieval path.
 *
 * Caches the always-on context (D0/D1 layers across temporal levels)
 * so that the 95% retrieval path never hits PostgreSQL. Context assembly
 * completes in sub-millisecond time from cached data.
 */
export default class RedisCache {
    /** The Redis client instance. */
    private client: Redis;

    /** Key prefix for namespacing TAMS entries. */
    private prefix: string;

    /** Resolved STM buffer configuration. */
    private stmConfig: STMConfig;

    /** Tracks cache hits vs misses for monitoring. */
    private hits = 0;
    private misses = 0;

    public constructor(
        private config: RedisConfig,
        stmConfig?: Partial<STMConfig>
    ) {
        this.prefix = config.keyPrefix ?? DEFAULT_PREFIX;
        this.stmConfig = { ...DEFAULT_STM, ...stmConfig };

        this.client = new Redis({
            host: config.host,
            port: config.port,
            password: config.password,
            lazyConnect: true
        });
    }

    /**
     * Connects to Redis. Safe to call multiple times.
     */
    public async initialize(): Promise<void> {
        await this.client.connect();
        log.info('Redis cache connected.');
    }

    /**
     * Retrieves the cached always-on context.
     *
     * @param userId - The owning user's UUID.
     * @param now - Reference time for resolving "current" paths.
     * @returns The cached context, or null if not in cache (miss).
     */
    public async getContext(userId: string, now: Date = new Date()): Promise<MemoryContext | null> {
        const key = this.buildContextKey(userId, now),
            cached = await this.client.get(key);

        if (cached) {
            this.hits++;
            return JSON.parse(cached) as MemoryContext;
        }

        this.misses++;
        return null;
    }

    /**
     * Caches the always-on context block.
     *
     * @param userId - The owning user's UUID.
     * @param context - The assembled context to cache.
     * @param now - Reference time for the cache key.
     * @param ttl - Time-to-live in seconds. Defaults to 1 hour.
     */
    public async setContext(
        userId: string,
        context: MemoryContext,
        now: Date = new Date(),
        ttl = DEFAULT_TTL
    ): Promise<void> {
        const key = this.buildContextKey(userId, now);

        await this.client.set(key, JSON.stringify(context), 'EX', ttl);
    }

    /**
     * Caches a single layer value for direct lookup.
     *
     * @param path - The ltree path of the node.
     * @param depth - The abstraction depth.
     * @param content - The content to cache.
     * @param ttl - Time-to-live in seconds.
     */
    public async setLayer(
        path: string,
        depth: AbstractionDepth,
        content: string,
        ttl = DEFAULT_TTL
    ): Promise<void> {
        const key = this.buildLayerKey(path, depth);

        await this.client.set(key, content, 'EX', ttl);
    }

    /**
     * Retrieves a cached layer value.
     *
     * @param path - The ltree path of the node.
     * @param depth - The abstraction depth.
     * @returns The cached content, or null on miss.
     */
    public async getLayer(path: string, depth: AbstractionDepth): Promise<string | null> {
        const key = this.buildLayerKey(path, depth),
            cached = await this.client.get(key);

        if (cached) {
            this.hits++;
            return cached;
        }

        this.misses++;
        return null;
    }

    /**
     * Invalidates cache entries for a specific temporal path.
     *
     * Called after consolidation updates a node's D0/D1 content,
     * ensuring the next retrieval fetches fresh data from Postgres.
     *
     * @param userId - The owning user's UUID.
     * @param path - The ltree path whose cache entries should be cleared.
     */
    public async invalidate(userId: string, path: string): Promise<void> {
        const keys = [
            this.buildLayerKey(path, AbstractionDepth.D0),
            this.buildLayerKey(path, AbstractionDepth.D1)
        ];

        // Also invalidate the full context key for today
        const now = new Date();

        keys.push(this.buildContextKey(userId, now));

        const deleted = await this.client.del(...keys);

        log.debug(`Cache invalidated ${deleted} keys for path: ${path}`);
    }

    /**
     * Warms the cache by loading D0/D1 layers from provided context layers.
     *
     * Called at startup and after consolidation to pre-populate
     * the hot path with fresh data.
     *
     * @param layers - The context layers to cache.
     * @param ttl - Time-to-live in seconds.
     */
    public async warmup(layers: ContextLayer[], ttl = DEFAULT_TTL): Promise<void> {
        const pipeline = this.client.pipeline();

        for (const layer of layers) {
            const key = this.buildLayerKey(layer.path, layer.depth);

            pipeline.set(key, layer.content, 'EX', ttl);
        }

        await pipeline.exec();
        log.info(`Cache warmed with ${layers.length} layers.`);
    }

    /**
     * Returns cache performance statistics.
     */
    public getStats(): { hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;

        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0
        };
    }

    // --- Short-Term Memory Buffer ---

    /**
     * Pushes a conversation entry into the STM buffer.
     *
     * Uses a Redis sorted set with the timestamp as the score,
     * giving natural chronological ordering. Refreshes the TTL
     * on every push so active usage extends the window.
     *
     * @param userId - The owning user's UUID.
     * @param entry - The STM entry to buffer.
     * @returns The current buffer size after insertion.
     */
    public async stmPush(userId: string, entry: STMEntry): Promise<number> {
        const key = this.buildSTMKey(userId),
            member = JSON.stringify(entry);

        await this.client.zadd(key, entry.storedAt, member);
        await this.client.expire(key, this.stmConfig.ttl);

        return this.client.zcard(key);
    }

    /**
     * Retrieves all entries currently in the STM buffer,
     * ordered newest-first (highest score first).
     *
     * @param userId - The owning user's UUID.
     * @returns Array of STM entries, newest first.
     */
    public async stmGetAll(userId: string): Promise<STMEntry[]> {
        const key = this.buildSTMKey(userId),
            members = await this.client.zrevrange(key, 0, -1);

        return members.map((m) => JSON.parse(m) as STMEntry);
    }

    /**
     * Evicts and returns the oldest entry from the STM buffer.
     *
     * Uses ZRANGE to get the lowest-scored (oldest) member,
     * then removes it atomically.
     *
     * @param userId - The owning user's UUID.
     * @returns The evicted entry, or null if the buffer is empty.
     */
    public async stmEvictOldest(userId: string): Promise<STMEntry | null> {
        const key = this.buildSTMKey(userId),
            oldest = await this.client.zrange(key, 0, 0);

        if (oldest.length === 0) return null;

        await this.client.zrem(key, oldest[0]);

        return JSON.parse(oldest[0]) as STMEntry;
    }

    /**
     * Returns the current number of entries in the STM buffer.
     *
     * @param userId - The owning user's UUID.
     */
    public async stmSize(userId: string): Promise<number> {
        return this.client.zcard(this.buildSTMKey(userId));
    }

    /**
     * Clears the entire STM buffer.
     *
     * @param userId - The owning user's UUID.
     */
    public async stmClear(userId: string): Promise<void> {
        await this.client.del(this.buildSTMKey(userId));
    }

    /**
     * Returns the resolved STM configuration.
     */
    public getSTMConfig(): STMConfig {
        return this.stmConfig;
    }

    // --- User Prompts Buffer ---

    /**
     * Pushes a user prompt into the prompts buffer.
     *
     * Uses a Redis sorted set with the timestamp as the score,
     * giving natural chronological ordering. Refreshes the TTL
     * on every push so active usage extends the window.
     *
     * @param userId - The owning user's UUID.
     * @param entry - The prompt entry to buffer.
     * @returns The current buffer size after insertion.
     */
    public async promptPush(userId: string, entry: PromptEntry): Promise<number> {
        const key = this.buildPromptKey(userId),
            member = JSON.stringify(entry);

        await this.client.zadd(key, entry.storedAt, member);
        await this.client.expire(key, this.stmConfig.ttl);

        return this.client.zcard(key);
    }

    /**
     * Retrieves all entries currently in the prompts buffer,
     * ordered newest-first (highest score first).
     *
     * @param userId - The owning user's UUID.
     * @returns Array of prompt entries, newest first.
     */
    public async promptGetAll(userId: string): Promise<PromptEntry[]> {
        const key = this.buildPromptKey(userId),
            members = await this.client.zrevrange(key, 0, -1);

        return members.map((m) => JSON.parse(m) as PromptEntry);
    }

    /**
     * Evicts and returns the oldest entry from the prompts buffer.
     *
     * @param userId - The owning user's UUID.
     * @returns The evicted entry, or null if the buffer is empty.
     */
    public async promptEvictOldest(userId: string): Promise<PromptEntry | null> {
        const key = this.buildPromptKey(userId),
            oldest = await this.client.zrange(key, 0, 0);

        if (oldest.length === 0) return null;

        await this.client.zrem(key, oldest[0]);

        return JSON.parse(oldest[0]) as PromptEntry;
    }

    /**
     * Returns the current number of entries in the prompts buffer.
     *
     * @param userId - The owning user's UUID.
     */
    public async promptSize(userId: string): Promise<number> {
        return this.client.zcard(this.buildPromptKey(userId));
    }

    /**
     * Clears the entire prompts buffer.
     *
     * @param userId - The owning user's UUID.
     */
    public async promptClear(userId: string): Promise<void> {
        await this.client.del(this.buildPromptKey(userId));
    }

    /**
     * Gracefully closes the Redis connection.
     */
    public async close(): Promise<void> {
        await this.client.quit();
        log.info('Redis cache disconnected.');
    }

    /**
     * Builds the cache key for the full context block.
     * Keyed by user and current day to naturally rotate context.
     */
    private buildContextKey(userId: string, now: Date): string {
        const year = now.getFullYear(),
            month = String(now.getMonth() + 1).padStart(2, '0'),
            day = String(now.getDate()).padStart(2, '0');

        return `${this.prefix}:${userId}:context:${year}.${month}.${day}`;
    }

    /**
     * Builds the cache key for a single layer entry.
     */
    private buildLayerKey(path: string, depth: AbstractionDepth): string {
        return `${this.prefix}:layer:${path}:D${depth}`;
    }

    /**
     * Builds the Redis key for the STM buffer sorted set.
     * Scoped per user for multi-user isolation.
     */
    private buildSTMKey(userId: string): string {
        return `${this.prefix}:${userId}:stm:buffer`;
    }

    /**
     * Builds the Redis key for the user prompts sorted set.
     * Scoped per user for multi-user isolation.
     */
    private buildPromptKey(userId: string): string {
        return `${this.prefix}:${userId}:stm:prompts`;
    }
}
