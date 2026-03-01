import { AbstractionDepth, TemporalLevel, buildPathFromDate, getCurrentPaths } from '@tams/common';

/**
 * The result of a retrieval planning decision.
 */
export interface PlanResult {
    /** The temporal paths to query, ordered from broadest to narrowest. */
    paths: string[];

    /** The maximum abstraction depth to load. */
    maxDepth: AbstractionDepth;

    /** Human-readable explanation of why this depth was chosen. */
    reason: string;
}

/**
 * Rule-based retrieval planner for the prototype.
 *
 * Analyzes the user's message to determine what temporal scope
 * and abstraction depth is needed. In production this would be
 * replaced by a lightweight LLM call (Haiku-class), but for the
 * prototype, pattern matching is sufficient and zero-cost.
 *
 * Maps to the depth selection table from the TAMS design doc:
 * - Casual greeting -> D0 only
 * - Continuing recent work -> D0-D1
 * - Asking about known topic -> D0-D2
 * - Looking up specific facts -> D0-D3
 * - Understanding past reasoning -> D0-D4
 * - Tracing decision process -> D0-D5
 * - Verbatim recall -> D0-D6
 */
export default class RetrievalPlanner {
    /**
     * Plans the retrieval strategy for a user message.
     *
     * @param message - The user's message text.
     * @param now - Reference time for temporal resolution.
     * @returns The retrieval plan with paths, depth, and reason.
     */
    public plan(message: string, now: Date = new Date()): PlanResult {
        const lower = message.toLowerCase(),
            paths = this.resolveTemporalScope(lower, now),
            { depth, reason } = this.resolveDepth(lower);

        return { paths, maxDepth: depth, reason };
    }

    /**
     * Determines which temporal paths to query based on temporal
     * references in the user's message.
     */
    private resolveTemporalScope(message: string, now: Date): string[] {
        const current = getCurrentPaths(now),
            paths: string[] = [];

        // Check for explicit temporal references
        if (this.matches(message, LAST_YEAR_PATTERNS)) {
            const lastYear = new Date(now);

            lastYear.setFullYear(lastYear.getFullYear() - 1);
            paths.push(buildPathFromDate(lastYear, TemporalLevel.Year));
        }

        if (this.matches(message, LAST_MONTH_PATTERNS)) {
            const lastMonth = new Date(now);

            lastMonth.setMonth(lastMonth.getMonth() - 1);
            paths.push(buildPathFromDate(lastMonth, TemporalLevel.Month));
        }

        if (this.matches(message, YESTERDAY_PATTERNS)) {
            const yesterday = new Date(now);

            yesterday.setDate(yesterday.getDate() - 1);
            paths.push(buildPathFromDate(yesterday, TemporalLevel.Day));
        }

        if (this.matches(message, LAST_WEEK_PATTERNS)) {
            // Load the last 7 days
            for (let i = 1; i <= 7; i++) {
                const past = new Date(now);

                past.setDate(past.getDate() - i);
                paths.push(buildPathFromDate(past, TemporalLevel.Day));
            }
        }

        // Default: current day context
        if (paths.length === 0) paths.push(current[TemporalLevel.Day]);

        // Always include current temporal context for reference
        paths.unshift(current[TemporalLevel.Year]);
        paths.unshift(current[TemporalLevel.Month]);

        // Deduplicate
        return [...new Set(paths)];
    }

    /**
     * Determines the maximum retrieval depth based on specificity
     * signals in the user's message.
     */
    private resolveDepth(message: string): { depth: AbstractionDepth; reason: string } {
        // Verbatim recall (D6)
        if (this.matches(message, VERBATIM_PATTERNS)) {
            return { depth: AbstractionDepth.D6, reason: 'Verbatim recall requested' };
        }

        // Decision tracing (D5)
        if (this.matches(message, TRACE_PATTERNS)) {
            return { depth: AbstractionDepth.D5, reason: 'Decision process tracing' };
        }

        // Reasoning understanding (D4)
        if (this.matches(message, REASONING_PATTERNS)) {
            return { depth: AbstractionDepth.D4, reason: 'Reasoning/rationale requested' };
        }

        // Specific facts (D3)
        if (this.matches(message, FACT_PATTERNS)) {
            return { depth: AbstractionDepth.D3, reason: 'Specific facts requested' };
        }

        // Topic query (D2)
        if (this.matches(message, TOPIC_PATTERNS)) {
            return { depth: AbstractionDepth.D2, reason: 'Topic-level query' };
        }

        // Continuation of recent work (D1)
        if (this.matches(message, CONTINUATION_PATTERNS)) {
            return { depth: AbstractionDepth.D1, reason: 'Continuing recent work' };
        }

        // Default: shallow context only
        return { depth: AbstractionDepth.D0, reason: 'Default shallow context' };
    }

    /**
     * Checks if the message matches any pattern in the list.
     */
    private matches(message: string, patterns: RegExp[]): boolean {
        return patterns.some((pattern) => pattern.test(message));
    }
}

// --- Pattern definitions ---

const VERBATIM_PATTERNS = [
    /what exactly did (i|we) say/,
    /exact words/,
    /verbatim/,
    /word for word/,
    /quote (me|what)/
];

const TRACE_PATTERNS = [
    /walk me through/,
    /how did (we|i) get (here|to|there)/,
    /step by step/,
    /trace the/,
    /sequence of/,
    /what led to/
];

const REASONING_PATTERNS = [
    /why did (we|i|you)/,
    /what was the reasoning/,
    /explain the decision/,
    /rationale for/,
    /trade-?offs?/,
    /alternatives? (we|i) considered/,
    /pros and cons/
];

const FACT_PATTERNS = [
    /what (database|tool|framework|library|language) did/,
    /which .+ (did we|do we)/,
    /what (is|was) (my|our|the) .+ (stack|setup|config)/,
    /who (is|was)/,
    /when did (we|i)/,
    /what version/
];

const TOPIC_PATTERNS = [
    /what (topics?|things?) did (we|i)/,
    /what (have we|did we) (cover|discuss|talk about|work on)/,
    /what('s| is) (my|our) (current|tech) stack/,
    /overview of/,
    /summary of/,
    /what are (we|my) working on/
];

const CONTINUATION_PATTERNS = [
    /let'?s (keep|continue|pick up|resume)/,
    /where (did we|were we) (leave off|stop)/,
    /back to (work|what we were)/,
    /carry on/
];

const LAST_YEAR_PATTERNS = [/last year/, /previous year/];
const LAST_MONTH_PATTERNS = [/last month/, /previous month/];
const YESTERDAY_PATTERNS = [/yesterday/, /last night/];
const LAST_WEEK_PATTERNS = [/last week/, /this week/, /past (7|seven) days?/];
