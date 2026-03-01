/**
 * The five temporal levels that organize memory in time.
 *
 * Each level represents a progressively wider time scope. Memory nodes
 * at each level contain their own full 7-layer abstraction stack (D0-D6),
 * creating a fractal structure where the same pattern repeats at every scale.
 *
 * Conversations are the natural atomic unit — episodic boundaries
 * matching how memory actually works, not arbitrary clock divisions.
 *
 * Year > Month > Week > Day > Conversation
 */
export enum TemporalLevel {
    Year = 'year',
    Month = 'month',
    Week = 'week',
    Day = 'day',
    Conversation = 'conversation'
}

/**
 * Ordered list of temporal levels from broadest to narrowest scope.
 * Used for tree traversal and consolidation ordering.
 */
export const TEMPORAL_ORDER: TemporalLevel[] = [
    TemporalLevel.Year,
    TemporalLevel.Month,
    TemporalLevel.Week,
    TemporalLevel.Day,
    TemporalLevel.Conversation
];

/**
 * Maps each temporal level to its immediate parent in the hierarchy.
 * Year has no parent (it is the root level).
 */
export const TEMPORAL_PARENT: Record<TemporalLevel, TemporalLevel | null> = {
    [TemporalLevel.Year]: null,
    [TemporalLevel.Month]: TemporalLevel.Year,
    [TemporalLevel.Week]: TemporalLevel.Month,
    [TemporalLevel.Day]: TemporalLevel.Week,
    [TemporalLevel.Conversation]: TemporalLevel.Day
};

/**
 * Maps each temporal level to its immediate child in the hierarchy.
 * Conversation has no child (it is the leaf level / atomic episode).
 */
export const TEMPORAL_CHILD: Record<TemporalLevel, TemporalLevel | null> = {
    [TemporalLevel.Year]: TemporalLevel.Month,
    [TemporalLevel.Month]: TemporalLevel.Week,
    [TemporalLevel.Week]: TemporalLevel.Day,
    [TemporalLevel.Day]: TemporalLevel.Conversation,
    [TemporalLevel.Conversation]: null
};
