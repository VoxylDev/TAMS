import type { AbstractionDepth } from '../enums/depth.js';
import type { TemporalLevel } from '../enums/temporal.js';

/**
 * A single node in the TAMS memory tree.
 *
 * Each node lives at a specific position in the temporal hierarchy (year/month/day/hour)
 * and at a specific abstraction depth (D0-D6). The combination of path + depth uniquely
 * identifies a memory's content at a particular granularity.
 */
export interface MemoryNode {
    /** Unique identifier for this node. */
    id: string;

    /** The ltree path encoding this node's position in the temporal tree. */
    path: string;

    /** Which temporal level this node belongs to. */
    temporal: TemporalLevel;

    /** Which abstraction depth this node represents. */
    depth: AbstractionDepth;

    /** UUID of the parent node in the temporal hierarchy. Null for root (year) nodes. */
    parentId: string | null;

    /** The actual memory content at this abstraction level. */
    content: string;

    /** Structured entity data (D3 layer). Contains names, tools, decisions, relationships. */
    entities: Record<string, unknown>;

    /** Approximate token count of the content. Used for cost tracking and low-signal detection. */
    tokenCount: number;

    /** When this node was first created. */
    createdAt: Date;

    /** When this node's content was last modified. */
    updatedAt: Date;

    /** When this node was last processed by the consolidation pipeline. Null if never consolidated. */
    consolidatedAt: Date | null;
}

/**
 * Parameters for creating a new memory node.
 * The id, createdAt, and updatedAt fields are auto-generated.
 */
export interface CreateNodeParams {
    /** The ltree path for the new node. */
    path: string;

    /** Which temporal level this node belongs to. */
    temporal: TemporalLevel;

    /** Which abstraction depth this node represents. */
    depth: AbstractionDepth;

    /** UUID of the parent node. Null for root nodes. */
    parentId?: string | null;

    /** The memory content. */
    content: string;

    /** Structured entity data. Defaults to empty object. */
    entities?: Record<string, unknown>;

    /** Token count. Defaults to 0. */
    tokenCount?: number;
}

/**
 * Parameters for updating an existing memory node.
 * Only the fields that should change need to be provided.
 */
export interface UpdateNodeParams {
    /** New content to replace the existing content. */
    content?: string;

    /** Updated entity data. */
    entities?: Record<string, unknown>;

    /** Updated token count. */
    tokenCount?: number;

    /** Mark as consolidated at the given time. */
    consolidatedAt?: Date;
}
