import type { STMConfig } from './stm.js';

/**
 * PostgreSQL connection configuration.
 */
export interface DatabaseConfig {
    /** Database server hostname. */
    host: string;

    /** Database server port. */
    port: number;

    /** Database name. */
    database: string;

    /** Database username. */
    user: string;

    /** Database password. */
    password: string;

    /** Maximum number of connections in the pool. */
    maxConnections?: number;
}

/**
 * Redis connection configuration.
 */
export interface RedisConfig {
    /** Redis server hostname. */
    host: string;

    /** Redis server port. */
    port: number;

    /** Redis password. Optional if no auth is configured. */
    password?: string;

    /** Key prefix for all TAMS cache entries. */
    keyPrefix?: string;
}

/**
 * Configuration for the LLM-powered consolidation pipeline.
 *
 * Uses any OpenAI-compatible API (OpenAI, Anthropic, Ollama, OpenRouter,
 * Together, vLLM, etc.). Set `baseUrl` to your provider's endpoint.
 */
export interface ConsolidationConfig {
    /** API key for LLM calls. Works with any OpenAI-compatible provider. */
    apiKey: string;

    /**
     * Base URL for the LLM API.
     * Defaults to OpenAI's API (https://api.openai.com/v1).
     * Examples:
     *   - Ollama: http://localhost:11434/v1
     *   - OpenRouter: https://openrouter.ai/api/v1
     */
    baseUrl?: string;

    /**
     * Model to use for mechanical compression (D6->D5, D5->D4).
     * Defaults to gpt-4o-mini.
     */
    fastModel?: string;

    /**
     * Model to use for abstract synthesis (D3->D2->D1->D0).
     * Defaults to gpt-4o-mini.
     */
    abstractModel?: string;

    /**
     * Minimum token count for a conversation to be worth full consolidation.
     * Conversations below this threshold get minimal processing.
     */
    lowSignalThreshold?: number;
}

/**
 * Configuration for the automatic consolidation scheduler.
 *
 * The scheduler runs background timers that automatically trigger
 * day/week/month/year consolidation at the appropriate temporal
 * boundaries, keeping the always-on context fresh without manual
 * intervention.
 *
 * Each level has its own check interval. At each tick, the scheduler
 * iterates all registered users and triggers consolidation for any
 * temporal scope that has unconsolidated child data since the last run.
 */
export interface SchedulerConfig {
    /**
     * Whether the scheduler is enabled.
     * When false, no automatic consolidation occurs.
     * @default true
     */
    enabled: boolean;

    /**
     * How often to check for day-level consolidation (milliseconds).
     * Day consolidation merges conversation nodes into the current day.
     * @default 1800000 (30 minutes)
     */
    dayIntervalMs: number;

    /**
     * How often to check for week-level consolidation (milliseconds).
     * Week consolidation merges day nodes into the current week.
     * @default 7200000 (2 hours)
     */
    weekIntervalMs: number;

    /**
     * How often to check for month-level consolidation (milliseconds).
     * Month consolidation merges week nodes into the current month.
     * @default 21600000 (6 hours)
     */
    monthIntervalMs: number;

    /**
     * How often to check for year-level consolidation (milliseconds).
     * Year consolidation merges month nodes into the current year.
     * @default 86400000 (24 hours)
     */
    yearIntervalMs: number;
}

/**
 * Top-level TAMS configuration combining all subsystem configs.
 */
export interface TAMSConfig {
    /** PostgreSQL connection settings. */
    database: DatabaseConfig;

    /** Redis connection settings. */
    redis: RedisConfig;

    /** Consolidation pipeline settings. */
    consolidation: ConsolidationConfig;

    /** Short-term memory buffer settings. Optional — defaults applied if omitted. */
    stm?: Partial<STMConfig>;

    /** Automatic consolidation scheduler settings. Optional — defaults applied if omitted. */
    scheduler?: Partial<SchedulerConfig>;

    /** Log level: 'debug' | 'info' | 'warn' | 'error'. */
    logLevel?: string;
}
