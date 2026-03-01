import os from 'node:os';

import { log } from '@tams/common';

import type {
    TAMSConfig,
    DatabaseConfig,
    RedisConfig,
    ConsolidationConfig,
    STMConfig
} from '@tams/common';
import type { LogLevel } from '@tams/common';

/**
 * Loads TAMS configuration from environment variables.
 *
 * All variables use the TAMS_ prefix. The LLM API key uses
 * TAMS_LLM_API_KEY and works with any OpenAI-compatible provider.
 *
 * @returns The resolved configuration.
 * @throws If required environment variables are missing.
 */
export function loadConfig(): TAMSConfig {
    const database = loadDatabaseConfig(),
        redis = loadRedisConfig(),
        consolidation = loadConsolidationConfig(),
        stm = loadSTMConfig(),
        logLevel = (process.env.TAMS_LOG_LEVEL ?? 'info') as LogLevel;

    log.setLevel(logLevel);

    return { database, redis, consolidation, stm, logLevel };
}

/**
 * Loads PostgreSQL configuration from environment variables.
 */
function loadDatabaseConfig(): DatabaseConfig {
    return {
        host: env('TAMS_DB_HOST', 'localhost'),
        port: Number.parseInt(env('TAMS_DB_PORT', '5432'), 10),
        database: env('TAMS_DB_NAME', 'tams'),
        user: env('TAMS_DB_USER', 'tams'),
        password: env('TAMS_DB_PASSWORD', ''),
        maxConnections: Number.parseInt(env('TAMS_DB_MAX_CONNECTIONS', '10'), 10)
    };
}

/**
 * Loads Redis configuration from environment variables.
 */
function loadRedisConfig(): RedisConfig {
    return {
        host: env('TAMS_REDIS_HOST', 'localhost'),
        port: Number.parseInt(env('TAMS_REDIS_PORT', '6379'), 10),
        password: process.env.TAMS_REDIS_PASSWORD || undefined,
        keyPrefix: env('TAMS_REDIS_PREFIX', 'tams')
    };
}

/**
 * Loads LLM configuration for the consolidation pipeline.
 *
 * Uses TAMS_LLM_* environment variables. The API is OpenAI-compatible,
 * so it works with OpenAI, Anthropic, Ollama, OpenRouter, and more.
 * Set TAMS_LLM_BASE_URL to point at your provider's endpoint.
 */
function loadConsolidationConfig(): ConsolidationConfig {
    const apiKey = process.env.TAMS_LLM_API_KEY;

    if (!apiKey) log.warn('TAMS_LLM_API_KEY not set. Consolidation will fail.');

    return {
        apiKey: apiKey ?? '',
        baseUrl: process.env.TAMS_LLM_BASE_URL || undefined,
        fastModel: env('TAMS_LLM_FAST_MODEL', 'gpt-4o-mini'),
        abstractModel: env('TAMS_LLM_ABSTRACT_MODEL', 'gpt-4o-mini'),
        lowSignalThreshold: Number.parseInt(env('TAMS_LLM_LOW_SIGNAL_THRESHOLD', '50'), 10)
    };
}

/**
 * Loads short-term memory buffer configuration from environment variables.
 */
function loadSTMConfig(): Partial<STMConfig> {
    const config: Partial<STMConfig> = {};

    const maxEntries = process.env.TAMS_STM_MAX_ENTRIES;

    if (maxEntries) config.maxEntries = Number.parseInt(maxEntries, 10);

    const maxTailChars = process.env.TAMS_STM_MAX_TAIL_CHARS;

    if (maxTailChars) config.maxTailChars = Number.parseInt(maxTailChars, 10);

    const ttl = process.env.TAMS_STM_TTL;

    if (ttl) config.ttl = Number.parseInt(ttl, 10);

    const maxPrompts = process.env.TAMS_STM_MAX_PROMPTS;

    if (maxPrompts) config.maxPrompts = Number.parseInt(maxPrompts, 10);

    // Device name falls back to os.hostname() if not set
    config.deviceName = process.env.TAMS_DEVICE_NAME || os.hostname();

    return config;
}

/**
 * Reads an environment variable with an optional default.
 *
 * @param key - The environment variable name.
 * @param defaultValue - Fallback value if the variable is not set.
 * @returns The variable value.
 */
function env(key: string, defaultValue: string): string {
    return process.env[key] ?? defaultValue;
}
