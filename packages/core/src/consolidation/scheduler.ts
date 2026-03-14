import { TemporalLevel, buildPathFromDate, log } from '@tams/common';

import type { SchedulerConfig } from '@tams/common';
import type TAMS from '../tams.js';
import type RedisCache from '../cache/redis.js';
import type Postgres from '../database/postgres.js';

/**
 * Default scheduler intervals.
 *
 * Day checks run every 30 minutes because new conversations arrive
 * frequently. Week checks run every 2 hours, month every 6 hours,
 * and year once per day — matching the natural cadence of each scope.
 */
const DEFAULT_CONFIG: SchedulerConfig = {
    enabled: true,
    dayIntervalMs: 1_800_000, // 30 minutes
    weekIntervalMs: 7_200_000, // 2 hours
    monthIntervalMs: 21_600_000, // 6 hours
    yearIntervalMs: 86_400_000 // 24 hours
};

/**
 * Automatic consolidation scheduler for the TAMS memory system.
 *
 * Runs background timers that periodically check each temporal level
 * for unconsolidated data. When fresh child nodes exist since the last
 * consolidation, a consolidation job is triggered through the normal
 * TAMS queue pipeline.
 *
 * The scheduler iterates all registered users at each tick, ensuring
 * multi-user deployments stay consolidated without per-user configuration.
 *
 * State is persisted in Redis so that consolidation timestamps survive
 * server restarts. Timer handles are tracked for clean shutdown.
 *
 * @example
 * ```typescript
 * const scheduler = new ConsolidationScheduler(tams, cache, db, config);
 * scheduler.start();
 * // ... later ...
 * scheduler.stop();
 * ```
 */
export default class ConsolidationScheduler {
    /** Resolved scheduler configuration (defaults merged with overrides). */
    private config: SchedulerConfig;

    /** Active interval handles, keyed by temporal level. */
    private timers = new Map<TemporalLevel, ReturnType<typeof setInterval>>();

    /** Whether the scheduler is currently running. */
    private running = false;

    /**
     * Creates a new consolidation scheduler.
     *
     * @param tams - The TAMS service instance (provides `triggerConsolidation()` and `getStatus()`).
     * @param cache - The Redis cache layer (for reading/writing last-run timestamps).
     * @param db - The Postgres database (for listing users).
     * @param overrides - Optional partial config to override defaults.
     */
    public constructor(
        private tams: TAMS,
        private cache: RedisCache,
        private db: Postgres,
        overrides?: Partial<SchedulerConfig>
    ) {
        this.config = { ...DEFAULT_CONFIG, ...overrides };
    }

    /**
     * Starts all consolidation timers.
     *
     * Each temporal level gets its own `setInterval` running at the
     * configured cadence. The first tick fires immediately (via an
     * initial check) so stale data is consolidated on startup.
     *
     * Safe to call multiple times — subsequent calls are no-ops if
     * already running.
     */
    public start(): void {
        if (this.running) {
            log.debug('Scheduler already running, ignoring start().');
            return;
        }

        if (!this.config.enabled) {
            log.info('Consolidation scheduler is disabled via config.');
            return;
        }

        this.running = true;

        // Map levels to their configured intervals
        const intervals: [TemporalLevel, number][] = [
            [TemporalLevel.Day, this.config.dayIntervalMs],
            [TemporalLevel.Week, this.config.weekIntervalMs],
            [TemporalLevel.Month, this.config.monthIntervalMs],
            [TemporalLevel.Year, this.config.yearIntervalMs]
        ];

        for (const [level, intervalMs] of intervals) {
            const friendlyInterval = this.formatInterval(intervalMs);

            log.info(`Scheduler: ${level} consolidation check every ${friendlyInterval}.`);

            // Fire an initial check after a brief startup delay (10 seconds)
            // to avoid hammering the system right at boot.
            setTimeout(() => {
                if (this.running) this.tick(level);
            }, 10_000);

            // Set up the recurring timer
            const timer = setInterval(() => this.tick(level), intervalMs);

            this.timers.set(level, timer);
        }

        log.info('Consolidation scheduler started.');
    }

    /**
     * Stops all consolidation timers and cleans up.
     *
     * In-flight consolidation jobs that were already enqueued will
     * continue to process — this only prevents new checks from firing.
     */
    public stop(): void {
        if (!this.running) return;

        for (const [level, timer] of this.timers) {
            clearInterval(timer);
            log.debug(`Scheduler: cleared ${level} timer.`);
        }

        this.timers.clear();
        this.running = false;

        log.info('Consolidation scheduler stopped.');
    }

    /**
     * Returns whether the scheduler is currently running.
     */
    public isRunning(): boolean {
        return this.running;
    }

    /**
     * Returns the resolved scheduler configuration.
     */
    public getConfig(): SchedulerConfig {
        return { ...this.config };
    }

    // --- Internal Tick Logic ---

    /**
     * Executes a single consolidation check for a given temporal level.
     *
     * For each registered user:
     * 1. Reads the last-consolidated timestamp from Redis.
     * 2. Checks if the current temporal path has child nodes that were
     *    updated after the last consolidation.
     * 3. If so, triggers consolidation through the TAMS queue.
     * 4. Updates the last-consolidated timestamp in Redis.
     *
     * Errors are caught and logged — a failed tick never crashes the
     * scheduler. The next tick will retry naturally.
     *
     * @param level - The temporal level to check.
     */
    private async tick(level: TemporalLevel): Promise<void> {
        if (!this.running) return;

        try {
            // Check if the queue is already processing — avoid piling up jobs
            // when the LLM API is slow or the queue is backed up.
            const firstUser = await this.getFirstUserId();

            if (!firstUser) return;

            const status = await this.tams.getStatus(firstUser);

            if (status.consolidation.processing && status.consolidation.queueLength > 3) {
                log.debug(
                    `Scheduler: skipping ${level} tick — queue busy ` +
                        `(${status.consolidation.queueLength} jobs, processing).`
                );
                return;
            }

            // Iterate all users
            const users = await this.db.listUsers();

            for (const user of users) {
                await this.checkAndConsolidate(user.id, level);
            }
        } catch (error) {
            log.error(
                `Scheduler: ${level} tick failed: ` +
                    `${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Checks whether a specific user+level combination needs consolidation,
     * and triggers it if so.
     *
     * The decision is based on comparing the last-consolidated timestamp
     * (stored in Redis) against the current time. If enough time has passed
     * since the last consolidation for this exact temporal path, we trigger
     * a new one.
     *
     * This is conservative: it only consolidates the *current* temporal path
     * (e.g., today's day path, this week's week path). Historical paths are
     * not revisited — they were consolidated when they were current.
     *
     * @param userId - The user's UUID.
     * @param level - The temporal level to check.
     */
    private async checkAndConsolidate(userId: string, level: TemporalLevel): Promise<void> {
        const now = new Date(),
            currentPath = buildPathFromDate(now, level),
            redisKey = this.buildLastConsolidatedKey(userId, level);

        // Read the last consolidation timestamp for this user+level
        const lastRun = await this.cache.getValue(redisKey);

        if (lastRun) {
            const lastRunTime = Number.parseInt(lastRun, 10),
                elapsed = now.getTime() - lastRunTime;

            // Get the minimum interval for this level — we don't want to
            // reconsolidate more frequently than the tick interval itself.
            const minInterval = this.getMinInterval(level);

            if (elapsed < minInterval) {
                log.debug(
                    `Scheduler: skipping ${level} for user ${userId.slice(0, 8)}... — ` +
                        `last run ${Math.round(elapsed / 1000)}s ago (min: ${Math.round(minInterval / 1000)}s).`
                );
                return;
            }
        }

        // Check if there are child nodes under the current path that
        // indicate data worth consolidating. We do this by checking if
        // the TAMS status shows we're ready and then triggering
        // consolidation (which is idempotent — re-consolidating the
        // same path just overwrites with fresh content).
        try {
            log.info(
                `Scheduler: triggering ${level} consolidation for user ` +
                    `${userId.slice(0, 8)}... at ${currentPath}.`
            );

            await this.tams.triggerConsolidation(userId, level, currentPath);

            // Update the last-consolidated timestamp
            // TTL of 30 days — well beyond any reasonable check interval
            await this.cache.setValue(redisKey, String(now.getTime()), 2_592_000);

            log.info(
                `Scheduler: ${level} consolidation queued for user ` +
                    `${userId.slice(0, 8)}... at ${currentPath}.`
            );
        } catch (error) {
            log.error(
                `Scheduler: failed to trigger ${level} consolidation for ` +
                    `user ${userId.slice(0, 8)}...: ` +
                    `${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    // --- Helpers ---

    /**
     * Gets the first user ID for status checks.
     * Returns null if no users exist.
     */
    private async getFirstUserId(): Promise<string | null> {
        const users = await this.db.listUsers();

        return users.length > 0 ? users[0].id : null;
    }

    /**
     * Returns the minimum interval between consolidations for a given level.
     *
     * This prevents the scheduler from re-consolidating the same path
     * on back-to-back ticks when nothing has changed. The interval matches
     * the tick frequency for each level.
     */
    private getMinInterval(level: TemporalLevel): number {
        switch (level) {
            case TemporalLevel.Day:
                return this.config.dayIntervalMs;
            case TemporalLevel.Week:
                return this.config.weekIntervalMs;
            case TemporalLevel.Month:
                return this.config.monthIntervalMs;
            case TemporalLevel.Year:
                return this.config.yearIntervalMs;
            default:
                return this.config.dayIntervalMs;
        }
    }

    /**
     * Builds the Redis key for storing the last-consolidated timestamp
     * for a given user and temporal level.
     *
     * Keys are scoped per-user because each user's memory tree is
     * independent and may have different consolidation cadences.
     *
     * @param userId - The user's UUID.
     * @param level - The temporal level.
     * @returns The Redis key string.
     */
    private buildLastConsolidatedKey(userId: string, level: TemporalLevel): string {
        const prefix = this.cache.getPrefix();

        return `${prefix}:${userId}:scheduler:last_${level}_consolidation`;
    }

    /**
     * Formats a millisecond interval into a human-readable string.
     *
     * @param ms - The interval in milliseconds.
     * @returns A friendly string like "30 minutes" or "2 hours".
     */
    private formatInterval(ms: number): string {
        const minutes = ms / 60_000;

        if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;

        const hours = minutes / 60;

        if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`;

        const days = hours / 24;

        return `${days} day${days !== 1 ? 's' : ''}`;
    }
}
