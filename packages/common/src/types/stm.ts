/**
 * Device metadata captured at store time.
 *
 * Provides provenance information for multi-device workflows,
 * allowing the system to answer questions like "which device
 * were you on when we discussed X?"
 */
export interface DeviceInfo {
    /** User-friendly device name (from TAMS_DEVICE_NAME env var, or hostname). */
    name: string;

    /** The OS hostname (from os.hostname()). */
    hostname: string;

    /** The OS platform (from os.platform()): darwin, linux, win32, etc. */
    platform: string;
}

/**
 * A single entry in the short-term memory (STM) buffer.
 *
 * Stored in Redis as a sorted set member (scored by storedAt timestamp).
 * Contains the truncated tail of a conversation transcript for immediate
 * carry-over between agent sessions without waiting for LLM consolidation.
 */
export interface STMEntry {
    /** The ltree path where this conversation is stored in PostgreSQL. */
    path: string;

    /** Unix timestamp (ms) when this entry was buffered. */
    storedAt: number;

    /** Optional session identifier for provenance tracking. */
    sessionId?: string;

    /** Truncated tail content (~2000 chars / ~500 tokens). */
    content: string;

    /** Estimated token count of the content field. */
    tokenCount: number;

    /** Device metadata captured at store time. */
    device: DeviceInfo;
}

/**
 * Configuration for the short-term memory buffer.
 *
 * All fields have sensible defaults. Override via environment variables
 * (TAMS_STM_MAX_ENTRIES, TAMS_STM_MAX_TAIL_CHARS, TAMS_STM_TTL,
 * TAMS_DEVICE_NAME) or by passing a partial config at initialization.
 */
export interface STMConfig {
    /**
     * Maximum number of entries in the buffer.
     * When exceeded, the oldest entry is evicted.
     * @default 5
     */
    maxEntries: number;

    /**
     * Maximum characters to keep from the tail of each conversation.
     * Controls the per-entry token budget (~4 chars per token).
     * @default 2000
     */
    maxTailChars: number;

    /**
     * TTL for the STM buffer key in Redis (seconds).
     * Acts as a safety net — entries expire even if no new stores occur.
     * Active usage extends the TTL on every push.
     * @default 7200 (2 hours)
     */
    ttl: number;

    /**
     * Maximum number of user prompts to keep in the prompts buffer.
     * When exceeded, the oldest prompt is evicted.
     * @default 10
     */
    maxPrompts: number;

    /**
     * User-friendly device name override.
     * Falls back to os.hostname() if not set.
     */
    deviceName?: string;
}

/**
 * A single entry in the user prompts buffer.
 *
 * Stored in Redis as a sorted set member (scored by storedAt timestamp).
 * Captures the user's raw prompt text for session recovery and
 * "what did we last talk about?" queries.
 */
export interface PromptEntry {
    /** The user's raw prompt text. */
    content: string;

    /** Unix timestamp (ms) when this prompt was stored. */
    storedAt: number;

    /** Optional session identifier for provenance tracking. */
    sessionId?: string;

    /** Device metadata captured at store time. */
    device: DeviceInfo;
}
