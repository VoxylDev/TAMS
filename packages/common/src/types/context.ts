import type { AbstractionDepth } from '../enums/depth.js';
import type { TemporalLevel } from '../enums/temporal.js';
import type { STMEntry, PromptEntry } from './stm.js';

/**
 * A single layer entry in the always-on memory context.
 * Represents one temporal level's abstract summary.
 */
export interface ContextLayer {
    /** The temporal level this layer came from. */
    temporal: TemporalLevel;

    /** The abstraction depth (typically D0 or D1). */
    depth: AbstractionDepth;

    /** The ltree path of the source node. */
    path: string;

    /** The actual content at this layer. */
    content: string;
}

/**
 * The always-on memory context block injected into every prompt.
 *
 * Assembled from the top abstraction layers across the temporal hierarchy:
 * - Year D0: broad theme of the current year/era
 * - Month D0: what's happening this month
 * - Week D0: this week's theme
 * - Day D0: today's theme
 * - Day D1: today's gist (slightly more detail)
 *
 * Total size target: ~200-400 tokens. Served from cache in sub-millisecond time.
 */
export interface MemoryContext {
    /** The ordered list of context layers from broadest to narrowest scope. */
    layers: ContextLayer[];

    /**
     * Recent conversations from the short-term memory buffer.
     * Includes device metadata and relative timestamps for carry-over context.
     * Empty array if no recent conversations are buffered.
     */
    recentConversations: STMEntry[];

    /**
     * Recent user prompts from the prompts buffer.
     * Captures the user's actual words for session recovery and recall.
     * Empty array if no recent prompts are buffered.
     */
    recentPrompts: PromptEntry[];

    /** ISO timestamp of when this context was assembled. */
    assembledAt: string;

    /** Total estimated token count across all layers. */
    totalTokens: number;
}

/**
 * A request to retrieve memory at a specific temporal scope and depth.
 */
export interface RetrievalRequest {
    /** The temporal path to retrieve from (e.g. "year.2026.month.02.day.28"). */
    temporalPath?: string;

    /** Maximum abstraction depth to load. Defaults to D1 (gist). */
    maxDepth?: AbstractionDepth;

    /**
     * When true, the retrieval planner decides the optimal temporal scope
     * and depth based on the query content.
     */
    auto?: boolean;

    /** The user's query text, used by the retrieval planner when auto is true. */
    query?: string;
}

/**
 * The result of a memory retrieval operation.
 */
export interface RetrievalResult {
    /** The layers of memory content returned, ordered from shallowest to deepest. */
    layers: ContextLayer[];

    /** The temporal path that was resolved (may differ from request if auto-planned). */
    resolvedPath: string;

    /** The maximum depth that was loaded. */
    maxDepthLoaded: AbstractionDepth;

    /** How the retrieval was resolved: 'cache' | 'database' | 'planner'. */
    source: 'cache' | 'database' | 'planner';
}
