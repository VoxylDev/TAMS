import os from 'node:os';

import Postgres from './database/postgres.js';
import MemoryTree from './tree/tree.js';
import RedisCache from './cache/redis.js';
import Consolidator from './consolidation/consolidator.js';
import RetrievalPlanner from './consolidation/planner.js';

import {
    AbstractionDepth,
    TemporalLevel,
    buildPathFromDate,
    getParentPath,
    log
} from '@tams/common';

import type {
    TAMSConfig,
    MemoryContext,
    MemoryNode,
    RetrievalRequest,
    RetrievalResult,
    ContextLayer,
    STMEntry,
    DeviceInfo,
    PromptEntry
} from '@tams/common';
/**
 * A pending consolidation job in the background queue.
 */
interface ConsolidationJob {
    /** What type of consolidation to run. */
    type: 'conversation' | 'temporal';

    /** The ltree path to consolidate. */
    path: string;

    /** The user who owns this memory. */
    userId: string;

    /** The raw transcript (only for conversation jobs). */
    transcript?: string;

    /** The temporal level (for temporal jobs). */
    level?: TemporalLevel;

    /** When the job was enqueued. */
    enqueuedAt: Date;
}

/**
 * Status information for the TAMS system.
 */
export interface TAMSStatus {
    /** Whether the system is initialized and ready. */
    ready: boolean;

    /** Database statistics. */
    database: {
        totalNodes: number;
        byTemporal: Record<string, number>;
    };

    /** Cache performance statistics. */
    cache: {
        hits: number;
        misses: number;
        hitRate: number;
    };

    /** Consolidation statistics. */
    consolidation: {
        totalTokensUsed: number;
        queueLength: number;
        processing: boolean;
    };

    /** Short-term memory buffer statistics. */
    stm: {
        bufferSize: number;
        maxEntries: number;
    };

    /** User prompts buffer statistics. */
    prompts: {
        bufferSize: number;
        maxPrompts: number;
    };
}

/**
 * Result of a reconsolidation request.
 */
export interface ReconsolidationResult {
    /** Number of conversation transcripts found. */
    conversationsFound: number;

    /** Number of conversation consolidation jobs enqueued. */
    conversationJobsEnqueued: number;

    /** Number of temporal consolidation jobs enqueued. */
    temporalJobsEnqueued: number;

    /** Total jobs enqueued (conversations + temporal). */
    totalJobsEnqueued: number;

    /** Starting queue position for the first job. */
    queuePositionStart: number;

    /** Ending queue position for the last job. */
    queuePositionEnd: number;

    /** Unique temporal parent paths that will be reconsolidated. */
    temporalPaths: {
        day: string[];
        week: string[];
        month: string[];
        year: string[];
    };
}

/**
 * The main TAMS service class — the unified API for the memory system.
 *
 * Ties together the PostgreSQL database, Redis cache, consolidation
 * pipeline, and retrieval planner into a single cohesive interface.
 * This is the only class that external consumers (the MCP server)
 * need to interact with.
 */
export default class TAMS {
    /** PostgreSQL connection manager. */
    private db!: Postgres;

    /** High-level memory tree operations. */
    private tree!: MemoryTree;

    /** Redis hot cache for the always-on context. */
    private cache!: RedisCache;

    /** The consolidation pipeline for compressing memories. */
    private consolidator!: Consolidator;

    /** Rule-based retrieval planner. */
    private planner: RetrievalPlanner;

    /** Whether the system has been initialized. */
    private ready = false;

    /**
     * Background consolidation queue.
     *
     * Jobs are processed one at a time to avoid overwhelming the LLM API
     * with parallel requests. Each job runs 6 sequential LLM calls, so
     * a queue of 4 jobs still takes ~10 minutes with Sonnet, but the
     * callers don't block waiting for it.
     */
    private queue: ConsolidationJob[] = [];

    /** Whether the queue processor is currently running. */
    private processing = false;

    public constructor(private config: TAMSConfig) {
        this.planner = new RetrievalPlanner();
    }

    /**
     * Initializes all subsystems: database connection, schema migration,
     * Redis cache connection, and cache warmup.
     *
     * Must be called before any other method.
     */
    public async initialize(): Promise<void> {
        log.info('Initializing TAMS...');

        // Initialize database
        this.db = new Postgres(this.config.database);
        await this.db.initialize();

        // Initialize tree operations
        this.tree = new MemoryTree(this.db);

        // Initialize cache (with STM buffer config)
        this.cache = new RedisCache(this.config.redis, this.config.stm);
        await this.cache.initialize();

        // Initialize consolidation pipeline
        this.consolidator = new Consolidator(this.tree, this.config.consolidation);

        this.ready = true;
        log.info('TAMS initialized successfully.');
    }

    /**
     * Returns the always-on memory context block.
     *
     * This is the ~200-400 token block injected into every prompt.
     * Served from Redis cache when possible (sub-millisecond).
     * Falls back to PostgreSQL on cache miss.
     *
     * @param userId - The authenticated user's UUID.
     * @returns The assembled memory context.
     */
    public async getContext(userId: string): Promise<MemoryContext> {
        this.ensureReady();

        // Try cache first for the base D0/D1 context
        const cached = await this.cache.getContext(userId),
            context = cached ?? (await this.tree.getContext(userId));

        // Cache the base context for next time (if it was a miss)
        if (!cached) await this.cache.setContext(userId, context);

        // Fetch STM buffer entries live from Redis (not from the cached context)
        const stmEntries = await this.cache.stmGetAll(userId),
            stmTokens = stmEntries.reduce((sum, e) => sum + e.tokenCount, 0);

        // Fetch user prompts buffer entries live from Redis
        const promptEntries = await this.cache.promptGetAll(userId),
            promptTokens = promptEntries.reduce(
                (sum, e) => sum + Math.ceil(e.content.length / 4),
                0
            );

        return {
            layers: context.layers,
            recentConversations: stmEntries,
            recentPrompts: promptEntries,
            assembledAt: new Date().toISOString(),
            totalTokens: context.totalTokens + stmTokens + promptTokens
        };
    }

    /**
     * Stores a conversation transcript and queues background consolidation.
     *
     * The transcript is stored immediately as D6 (raw) and the response
     * is returned within milliseconds. The full consolidation pipeline
     * (D5 through D0) runs in the background queue, processing one job
     * at a time to avoid overwhelming the LLM API.
     *
     * @param userId - The authenticated user's UUID.
     * @param transcript - The raw conversation transcript.
     * @param sessionId - Optional session identifier for tracking.
     * @returns The path where the conversation was stored and queue position.
     */
    public async storeConversation(
        userId: string,
        transcript: string,
        sessionId?: string,
        clientDevice?: DeviceInfo
    ): Promise<{ path: string; queued: boolean; queuePosition: number }> {
        this.ensureReady();

        const now = new Date(),
            path = buildPathFromDate(now, TemporalLevel.Conversation);

        log.info(`Storing conversation at ${path}${sessionId ? ` (session: ${sessionId})` : ''}`);

        // Store D6 (raw transcript) immediately so the data is persisted
        const estimatedTokens = Math.ceil(transcript.length / 4);

        await this.tree.store(userId, {
            path,
            temporal: TemporalLevel.Conversation,
            depth: AbstractionDepth.D6,
            content: transcript,
            tokenCount: estimatedTokens
        });

        // Push to the short-term memory buffer for immediate carry-over
        const stmConfig = this.cache.getSTMConfig(),
            tail = transcript.slice(-stmConfig.maxTailChars),
            tailTokens = Math.ceil(tail.length / 4);

        const entry: STMEntry = {
            path,
            storedAt: now.getTime(),
            sessionId,
            content: tail,
            tokenCount: tailTokens,
            device: clientDevice ?? this.getDeviceInfo()
        };

        const bufferSize = await this.cache.stmPush(userId, entry);

        log.debug(`STM buffer: pushed entry (${tailTokens} tokens). Buffer size: ${bufferSize}.`);

        // Evict the oldest entry if the buffer exceeded capacity
        if (bufferSize > stmConfig.maxEntries) {
            const evicted = await this.cache.stmEvictOldest(userId);

            if (evicted) {
                log.info(`STM flush: evicted oldest entry at ${evicted.path}.`);
            }
        }

        // Invalidate cached context so the next getContext() includes fresh STM data
        await this.cache.invalidate(userId, path);

        // Enqueue the consolidation job for background processing
        this.queue.push({
            type: 'conversation',
            path,
            transcript,
            userId,
            enqueuedAt: now
        });

        const queuePosition = this.queue.length;

        log.info(`Queued consolidation for ${path} (position ${queuePosition}).`);

        // Kick the queue processor (no-op if already running)
        this.processQueue();

        return { path, queued: true, queuePosition };
    }

    /**
     * Retrieves memory at a specified temporal scope and depth.
     *
     * Supports both manual retrieval (explicit path/depth) and automatic
     * retrieval via the retrieval planner (analyzes the query text).
     *
     * @param userId - The authenticated user's UUID.
     * @param request - The retrieval request parameters.
     * @returns The retrieval result with memory layers.
     */
    public async retrieve(userId: string, request: RetrievalRequest): Promise<RetrievalResult> {
        this.ensureReady();

        let paths: string[], maxDepth: AbstractionDepth;

        if (request.auto && request.query) {
            // Let the planner decide
            const plan = this.planner.plan(request.query);

            paths = plan.paths;
            maxDepth = plan.maxDepth;
            log.debug(
                `Planner decided: depth=${maxDepth}, paths=${paths.length}, reason=${plan.reason}`
            );
        } else {
            paths = request.temporalPath
                ? [request.temporalPath]
                : [buildPathFromDate(new Date(), TemporalLevel.Day)];
            maxDepth = request.maxDepth ?? AbstractionDepth.D1;
        }

        // Fetch layers from database
        const layers: ContextLayer[] = [];

        for (const path of paths) {
            const nodes = await this.tree.retrieve(userId, path, maxDepth);

            for (const node of nodes) {
                if (node.content.trim()) {
                    layers.push({
                        temporal: node.temporal,
                        depth: node.depth,
                        path: node.path,
                        content: node.content
                    });
                }
            }
        }

        return {
            layers,
            resolvedPath: paths[0],
            maxDepthLoaded: maxDepth,
            source: request.auto ? 'planner' : 'database'
        };
    }

    /**
     * Searches for entities across the D3 layer of the memory tree.
     *
     * @param userId - The authenticated user's UUID.
     * @param query - The search query (matched against entity JSON).
     * @param limit - Maximum number of results.
     * @returns Matching memory nodes with entity data.
     */
    public async search(userId: string, query: string, limit = 10): Promise<MemoryNode[]> {
        this.ensureReady();

        // Search across all major D3 entity fields — topics, entities, and tools.
        // Each field is a separate containment query because @> only matches
        // within the same JSON structure (can't OR across fields in one @>).
        return this.tree.searchEntitiesBroad(userId, query, limit);
    }

    /**
     * Queues temporal consolidation for a specific level.
     *
     * Merges all child nodes into the specified parent node.
     * For example, consolidateLevel('day') merges all conversation nodes
     * for today into the day-level abstraction.
     *
     * The consolidation runs in the background queue. Returns immediately
     * with the queue position.
     *
     * @param userId - The authenticated user's UUID.
     * @param level - The temporal level to consolidate.
     * @param path - Optional specific path. Defaults to current time.
     * @returns Queue position info.
     */
    public async triggerConsolidation(
        userId: string,
        level: TemporalLevel,
        path?: string
    ): Promise<{ path: string; queued: boolean; queuePosition: number }> {
        this.ensureReady();

        const targetPath = path ?? buildPathFromDate(new Date(), level);

        log.info(`Triggering ${level}-level consolidation at ${targetPath}`);

        this.queue.push({
            type: 'temporal',
            path: targetPath,
            userId,
            level,
            enqueuedAt: new Date()
        });

        const queuePosition = this.queue.length;

        log.info(`Queued temporal consolidation for ${targetPath} (position ${queuePosition}).`);

        this.processQueue();

        return { path: targetPath, queued: true, queuePosition };
    }

    /**
     * Re-runs the consolidation pipeline on existing conversation data.
     *
     * Fetches all D6 (raw transcript) conversation nodes, enqueues a
     * conversation consolidation job for each, then enqueues temporal
     * consolidation jobs for all affected parent nodes in bottom-up order
     * (day → week → month → year).
     *
     * Since insertNode() uses ON CONFLICT ... DO UPDATE, re-running
     * consolidation is fully idempotent — existing D0-D5 nodes are
     * overwritten with fresh content.
     *
     * @param userId - The authenticated user's UUID.
     * @param startDate - Optional: only reconsolidate conversations from this date.
     * @param endDate - Optional: only reconsolidate conversations up to this date.
     * @returns Summary of what was enqueued.
     */
    public async reconsolidate(
        userId: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<ReconsolidationResult> {
        this.ensureReady();

        log.info(
            `Starting reconsolidation${startDate ? ` from ${startDate.toISOString()}` : ''}${
                endDate ? ` to ${endDate.toISOString()}` : ''
            }...`
        );

        const transcripts = await this.db.getConversationTranscripts(userId, startDate, endDate);

        if (transcripts.length === 0) {
            log.info('No conversation transcripts found for reconsolidation.');

            return {
                conversationsFound: 0,
                conversationJobsEnqueued: 0,
                temporalJobsEnqueued: 0,
                totalJobsEnqueued: 0,
                queuePositionStart: this.queue.length,
                queuePositionEnd: this.queue.length,
                temporalPaths: { day: [], week: [], month: [], year: [] }
            };
        }

        log.info(`Found ${transcripts.length} conversation transcripts to reconsolidate.`);

        const queuePositionStart = this.queue.length + 1,
            now = new Date();

        // Phase 1: Enqueue conversation consolidation jobs.

        const dayPaths = new Set<string>(),
            weekPaths = new Set<string>(),
            monthPaths = new Set<string>(),
            yearPaths = new Set<string>();

        for (const transcript of transcripts) {
            this.queue.push({
                type: 'conversation',
                path: transcript.path,
                transcript: transcript.content,
                userId,
                enqueuedAt: now
            });

            // Walk up the tree to collect all temporal parent paths.
            //
            // For "year.2026.month.02.week.04.day.28.conv.abc123":
            //   1x getParentPath -> "year.2026.month.02.week.04.day.28"  (day)
            //   2x getParentPath -> "year.2026.month.02.week.04"         (week)
            //   3x getParentPath -> "year.2026.month.02"                 (month)
            //   4x getParentPath -> "year.2026"                          (year)
            const dayPath = getParentPath(transcript.path);

            if (dayPath) {
                dayPaths.add(dayPath);

                const weekPath = getParentPath(dayPath);

                if (weekPath) {
                    weekPaths.add(weekPath);

                    const monthPath = getParentPath(weekPath);

                    if (monthPath) {
                        monthPaths.add(monthPath);

                        const yearPath = getParentPath(monthPath);

                        if (yearPath) yearPaths.add(yearPath);
                    }
                }
            }
        }

        // Phase 2: Enqueue temporal consolidation jobs in bottom-up order.
        // Days must finish before weeks, weeks before months, etc.
        // The FIFO queue guarantees this ordering.

        const temporalLevels: [Set<string>, TemporalLevel][] = [
            [dayPaths, TemporalLevel.Day],
            [weekPaths, TemporalLevel.Week],
            [monthPaths, TemporalLevel.Month],
            [yearPaths, TemporalLevel.Year]
        ];

        let temporalJobsEnqueued = 0;

        for (const [paths, level] of temporalLevels) {
            const sorted = [...paths].sort();

            for (const path of sorted) {
                this.queue.push({
                    type: 'temporal',
                    path,
                    userId,
                    level,
                    enqueuedAt: now
                });

                temporalJobsEnqueued++;
            }
        }

        const totalJobsEnqueued = transcripts.length + temporalJobsEnqueued,
            queuePositionEnd = this.queue.length;

        log.info(
            `Reconsolidation queued: ${transcripts.length} conversation jobs, ` +
                `${temporalJobsEnqueued} temporal jobs (${totalJobsEnqueued} total). ` +
                `Queue positions ${queuePositionStart}-${queuePositionEnd}.`
        );

        this.processQueue();

        return {
            conversationsFound: transcripts.length,
            conversationJobsEnqueued: transcripts.length,
            temporalJobsEnqueued,
            totalJobsEnqueued,
            queuePositionStart,
            queuePositionEnd,
            temporalPaths: {
                day: [...dayPaths].sort(),
                week: [...weekPaths].sort(),
                month: [...monthPaths].sort(),
                year: [...yearPaths].sort()
            }
        };
    }

    /**
     * Returns system health and statistics for a specific user.
     *
     * @param userId - The authenticated user's UUID.
     */
    public async getStatus(userId: string): Promise<TAMSStatus> {
        if (!this.ready) {
            return {
                ready: false,
                database: { totalNodes: 0, byTemporal: {} },
                cache: { hits: 0, misses: 0, hitRate: 0 },
                consolidation: { totalTokensUsed: 0, queueLength: 0, processing: false },
                stm: { bufferSize: 0, maxEntries: 0 },
                prompts: { bufferSize: 0, maxPrompts: 0 }
            };
        }

        const dbStats = await this.db.getStats(userId),
            cacheStats = this.cache.getStats(),
            stmSize = await this.cache.stmSize(userId),
            promptSize = await this.cache.promptSize(userId),
            stmConfig = this.cache.getSTMConfig();

        return {
            ready: true,
            database: {
                totalNodes: dbStats.total,
                byTemporal: dbStats.byTemporal
            },
            cache: cacheStats,
            consolidation: {
                totalTokensUsed: this.consolidator.getTotalTokensUsed(),
                queueLength: this.queue.length,
                processing: this.processing
            },
            stm: {
                bufferSize: stmSize,
                maxEntries: stmConfig.maxEntries
            },
            prompts: {
                bufferSize: promptSize,
                maxPrompts: stmConfig.maxPrompts
            }
        };
    }

    /**
     * Returns the database instance for auth operations.
     *
     * Used by the HTTP server's auth middleware and admin endpoints
     * to validate tokens and manage users without going through the
     * memory-specific TAMS methods.
     */
    public getDatabase(): Postgres {
        return this.db;
    }

    /**
     * Gracefully shuts down all subsystems.
     */
    public async shutdown(): Promise<void> {
        log.info('Shutting down TAMS...');

        if (this.cache) await this.cache.close();
        if (this.db) await this.db.close();

        this.ready = false;
        log.info('TAMS shut down.');
    }

    /**
     * Processes the consolidation queue one job at a time.
     *
     * Runs as a fire-and-forget loop: when a job is enqueued,
     * `processQueue()` is called. If already processing, it's a no-op
     * (the loop will pick up the new job after the current one finishes).
     *
     * Jobs are sequential to avoid overwhelming the LLM API with
     * parallel requests. Each job runs 6 LLM calls, so processing
     * 4 jobs takes ~10 minutes with Sonnet — but callers returned
     * immediately when they enqueued.
     */
    private async processQueue(): Promise<void> {
        if (this.processing) return;

        this.processing = true;

        while (this.queue.length > 0) {
            const job = this.queue.shift()!;

            try {
                if (job.type === 'conversation' && job.transcript) {
                    const result = await this.consolidator.consolidateConversation(
                        job.userId,
                        job.path,
                        job.transcript
                    );

                    log.info(
                        `Background consolidation complete for ${job.path}: ` +
                            `${result.layersGenerated} layers, ${result.tokensUsed} tokens.`
                    );

                    // Auto-enqueue temporal consolidation for parent nodes.
                    // Walk up the tree (day → week → month → year) and enqueue
                    // temporal jobs for each level, skipping any already queued.
                    this.enqueueTemporalChain(job.userId, job.path);
                } else if (job.type === 'temporal' && job.level) {
                    const result = await this.consolidator.consolidateTemporal(
                        job.userId,
                        job.path,
                        job.level
                    );

                    log.info(
                        `Background temporal consolidation complete for ${job.path}: ` +
                            `${result.layersGenerated} layers, ${result.tokensUsed} tokens.`
                    );
                }

                // Invalidate cache after each job so reads get fresh data
                await this.cache.invalidate(job.userId, job.path);

                const now = new Date(),
                    dayPath = buildPathFromDate(now, TemporalLevel.Day),
                    weekPath = buildPathFromDate(now, TemporalLevel.Week),
                    monthPath = buildPathFromDate(now, TemporalLevel.Month),
                    yearPath = buildPathFromDate(now, TemporalLevel.Year);

                await Promise.all([
                    this.cache.invalidate(job.userId, dayPath),
                    this.cache.invalidate(job.userId, weekPath),
                    this.cache.invalidate(job.userId, monthPath),
                    this.cache.invalidate(job.userId, yearPath)
                ]);
            } catch (error) {
                log.error(
                    `Consolidation failed for ${job.path}: ` +
                        `${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.processing = false;
    }

    /**
     * Enqueues temporal consolidation jobs for all ancestor nodes of a
     * conversation path (day → week → month → year), skipping any paths
     * that already have a temporal job in the queue.
     *
     * @param userId - The owning user's UUID.
     * @param conversationPath - The ltree path of the completed conversation.
     */
    private enqueueTemporalChain(userId: string, conversationPath: string): void {
        const levels: TemporalLevel[] = [
            TemporalLevel.Day,
            TemporalLevel.Week,
            TemporalLevel.Month,
            TemporalLevel.Year
        ];

        // Walk up the parent chain from conversation → day → week → month → year
        let currentPath = getParentPath(conversationPath);
        let levelIndex = 0;

        while (currentPath && levelIndex < levels.length) {
            const level = levels[levelIndex];

            // Skip if a temporal job for this exact path is already queued
            const alreadyQueued = this.queue.some(
                (j) => j.type === 'temporal' && j.path === currentPath
            );

            if (!alreadyQueued) {
                this.queue.push({
                    type: 'temporal',
                    path: currentPath,
                    userId,
                    level,
                    enqueuedAt: new Date()
                });

                log.info(
                    `Auto-queued ${level} temporal consolidation for ${currentPath}.`
                );
            }

            currentPath = getParentPath(currentPath);
            levelIndex++;
        }
    }

    /**
     * Returns all entries currently in the STM buffer, newest first.
     * Used by the HTTP server for the /stm debug endpoint.
     *
     * @param userId - The authenticated user's UUID.
     */
    public async getSTMEntries(userId: string): Promise<STMEntry[]> {
        this.ensureReady();

        return this.cache.stmGetAll(userId);
    }

    /**
     * Clears the entire STM buffer.
     * Used by the HTTP server for the /stm/clear endpoint.
     *
     * @param userId - The authenticated user's UUID.
     */
    public async clearSTM(userId: string): Promise<void> {
        this.ensureReady();

        await this.cache.stmClear(userId);

        log.info('STM buffer cleared.');
    }

    /**
     * Stores a user prompt in the prompts buffer.
     *
     * Called by agents as they receive user messages, providing
     * verbatim capture of the user's words for session recovery
     * and "what did we last talk about?" recall.
     *
     * @param userId - The authenticated user's UUID.
     * @param prompt - The user's raw prompt text.
     * @param sessionId - Optional session identifier for tracking.
     * @param clientDevice - Optional device info from the calling client.
     * @returns Whether the prompt was stored and the current buffer size.
     */
    public async storePrompt(
        userId: string,
        prompt: string,
        sessionId?: string,
        clientDevice?: DeviceInfo
    ): Promise<{ stored: boolean; bufferSize: number }> {
        this.ensureReady();

        const now = new Date();

        const entry: PromptEntry = {
            content: prompt,
            storedAt: now.getTime(),
            sessionId,
            device: clientDevice ?? this.getDeviceInfo()
        };

        const bufferSize = await this.cache.promptPush(userId, entry);

        log.debug(
            `Prompt buffer: pushed entry (${prompt.length} chars). Buffer size: ${bufferSize}.`
        );

        // Evict the oldest entry if the buffer exceeded capacity
        const stmConfig = this.cache.getSTMConfig();

        if (bufferSize > stmConfig.maxPrompts) {
            const evicted = await this.cache.promptEvictOldest(userId);

            if (evicted) {
                log.debug('Prompt buffer: evicted oldest entry.');
            }
        }

        return { stored: true, bufferSize };
    }

    /**
     * Returns all entries currently in the prompts buffer, newest first.
     * Used by the HTTP server for the /prompts debug endpoint.
     *
     * @param userId - The authenticated user's UUID.
     */
    public async getPromptEntries(userId: string): Promise<PromptEntry[]> {
        this.ensureReady();

        return this.cache.promptGetAll(userId);
    }

    /**
     * Clears the entire prompts buffer.
     * Used by the HTTP server for the /prompts/clear endpoint.
     *
     * @param userId - The authenticated user's UUID.
     */
    public async clearPrompts(userId: string): Promise<void> {
        this.ensureReady();

        await this.cache.promptClear(userId);

        log.info('Prompts buffer cleared.');
    }

    /**
     * Builds device metadata from the current environment.
     *
     * Uses the TAMS_DEVICE_NAME env var (via STM config) as the friendly name,
     * falling back to os.hostname(). Platform and hostname are always captured
     * automatically for provenance tracking.
     */
    private getDeviceInfo(): DeviceInfo {
        const stmConfig = this.cache.getSTMConfig();

        return {
            name: stmConfig.deviceName ?? os.hostname(),
            hostname: os.hostname(),
            platform: os.platform()
        };
    }

    /**
     * Throws if the system hasn't been initialized yet.
     */
    private ensureReady(): void {
        if (!this.ready) throw new Error('TAMS not initialized. Call initialize() first.');
    }
}
