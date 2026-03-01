/**
 * The seven abstraction layers that define how compressed a memory is.
 *
 * D0 is the most abstract (a single sentence theme), D6 is the raw
 * uncompressed transcript. Storage compresses top-down (D6 -> D0),
 * retrieval expands bottom-up and stays shallow by default.
 *
 * Each temporal node in the memory tree contains its own complete
 * D0-D6 stack, creating the "double funnel" architecture described
 * in the TAMS design document.
 */
export enum AbstractionDepth {
    /** Theme — one sentence capturing the abstract essence. */
    D0 = 0,

    /** Gist — 2-3 sentences of what happened and what was decided. */
    D1 = 1,

    /** Outline — bullet-level topic map, one line per topic. */
    D2 = 2,

    /** Entities — structured JSON of names, tools, decisions, relationships. */
    D3 = 3,

    /** Detail — per-topic paragraph summaries preserving reasoning chains. */
    D4 = 4,

    /** Exchanges — compressed dialog with filler stripped. */
    D5 = 5,

    /** Raw — the full unmodified transcript. Written once, read almost never. */
    D6 = 6
}

/**
 * Human-readable metadata for each abstraction depth.
 * Used for logging, debugging, and format contract enforcement.
 */
export const DEPTH_META: Record<
    AbstractionDepth,
    { name: string; format: string; description: string }
> = {
    [AbstractionDepth.D0]: {
        name: 'Theme',
        format: 'Single sentence',
        description: 'The abstract essence — mood, intent, or category.'
    },
    [AbstractionDepth.D1]: {
        name: 'Gist',
        format: '2-3 sentences',
        description: 'What happened and what was decided. Minimum viable summary.'
    },
    [AbstractionDepth.D2]: {
        name: 'Outline',
        format: 'Bullet list',
        description: 'Key topics covered and positions taken. One line per topic.'
    },
    [AbstractionDepth.D3]: {
        name: 'Entities',
        format: 'Structured JSON',
        description: 'Names, tools, decisions, and relationships as machine-readable data.'
    },
    [AbstractionDepth.D4]: {
        name: 'Detail',
        format: 'Paragraphs',
        description: 'Per-topic summaries preserving reasoning chains and trade-offs.'
    },
    [AbstractionDepth.D5]: {
        name: 'Exchanges',
        format: 'Compressed dialog',
        description: 'Back-and-forth with filler stripped, preserving decision flow.'
    },
    [AbstractionDepth.D6]: {
        name: 'Raw',
        format: 'Full transcript',
        description: 'The unmodified conversation, word for word.'
    }
};

/** The shallowest depth — always loaded, costs almost nothing. */
export const DEPTH_MIN = AbstractionDepth.D0;

/** The deepest depth — raw transcript, read almost never. */
export const DEPTH_MAX = AbstractionDepth.D6;

/**
 * Depths that are immutable between consolidation cycles (D0-D3).
 * Only rewritten during scheduled consolidation passes.
 */
export const IMMUTABLE_DEPTHS: AbstractionDepth[] = [
    AbstractionDepth.D0,
    AbstractionDepth.D1,
    AbstractionDepth.D2,
    AbstractionDepth.D3
];

/**
 * Depths that are written in real-time as conversations happen (D4-D6).
 */
export const REALTIME_DEPTHS: AbstractionDepth[] = [
    AbstractionDepth.D4,
    AbstractionDepth.D5,
    AbstractionDepth.D6
];
