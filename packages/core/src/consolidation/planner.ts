import {
    AbstractionDepth,
    TemporalLevel,
    buildPathFromDate,
    getCurrentPaths,
    log
} from '@tams/common';

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
 * Minimal interface for LLM calls used by the planner.
 *
 * Decouples the planner from any specific LLM provider — callers
 * supply a thin adapter that maps to their SDK of choice.
 */
export interface PlannerLLMClient {
    /** Sends a system+user message and returns the text response. */
    complete(system: string, user: string): Promise<string>;
}

/**
 * Retrieval planner with dual-mode query analysis.
 *
 * Supports two complementary strategies for determining temporal
 * scope and abstraction depth:
 *
 * 1. **LLM mode** (default when a client is provided) — sends a
 *    lightweight LLM call to analyze intent, temporal references,
 *    and specificity. Handles ambiguous queries that regex patterns
 *    miss.
 *
 * 2. **Rule mode** (regex fallback) — the original pattern-matching
 *    approach. Zero-cost and deterministic, used when the LLM client
 *    is not configured or when the LLM call fails.
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
     * Creates a new retrieval planner.
     *
     * @param llm - Optional LLM client for smart planning. When
     *              provided, the planner uses LLM-based analysis
     *              with regex fallback. When omitted, only regex
     *              rules are used.
     */
    public constructor(private llm?: PlannerLLMClient) {}

    /**
     * Plans the retrieval strategy for a user message.
     *
     * Routes to the LLM planner when available, falling back to
     * rule-based planning on any failure. This ensures retrieval
     * always returns a valid plan, even if the LLM is down or
     * returns unparseable output.
     *
     * @param message - The user's message text.
     * @param now - Reference time for temporal resolution.
     * @returns The retrieval plan with paths, depth, and reason.
     */
    public async plan(message: string, now: Date = new Date()): Promise<PlanResult> {
        if (this.llm) {
            try {
                return await this.planWithLLM(message, now);
            } catch (error) {
                log.warn(`LLM planner failed, falling back to rules: ${error}`);
            }
        }

        return this.planWithRules(message, now);
    }

    // ----------------------------------------------------------------
    //  LLM-based planning
    // ----------------------------------------------------------------

    /**
     * Analyzes the user's message with a lightweight LLM call to
     * determine optimal retrieval scope and depth.
     *
     * The prompt gives the LLM full context about the temporal path
     * format and depth levels, allowing it to handle nuanced queries
     * like "what did I ask you to remember?" or "anything about auth
     * from last Tuesday?" that regex patterns can't match.
     *
     * @param message - The user's message text.
     * @param now - Reference time for temporal resolution.
     * @returns The LLM-determined retrieval plan.
     * @throws On parse failure, timeout, or any LLM error.
     */
    private async planWithLLM(message: string, now: Date): Promise<PlanResult> {
        const system = this.buildLLMPrompt(now),
            response = await this.llm!.complete(system, message);

        // Strip markdown code fences if the LLM wrapped its JSON response
        const cleaned = response
            .replace(/```(?:json)?\s*/g, '')
            .replace(/```\s*/g, '')
            .trim();

        // Parse and validate the structured response
        const parsed = JSON.parse(cleaned) as {
            paths?: unknown;
            maxDepth?: unknown;
            reason?: unknown;
        };

        if (!Array.isArray(parsed.paths) || parsed.paths.length === 0) {
            throw new Error('LLM response missing valid "paths" array');
        }

        if (typeof parsed.maxDepth !== 'number' || parsed.maxDepth < 0 || parsed.maxDepth > 6) {
            throw new Error(`LLM response has invalid "maxDepth": ${parsed.maxDepth}`);
        }

        return {
            paths: parsed.paths as string[],
            maxDepth: parsed.maxDepth as AbstractionDepth,
            reason: typeof parsed.reason === 'string' ? parsed.reason : 'LLM-planned retrieval'
        };
    }

    /**
     * Builds the system prompt for the LLM planner.
     *
     * Provides the current timestamp, temporal path format, depth
     * level definitions, and guidelines for scope/depth selection.
     * Kept compact to minimize token usage on lightweight models.
     *
     * @param now - Reference time for the prompt.
     * @returns The complete system prompt string.
     */
    private buildLLMPrompt(now: Date): string {
        return `You are a retrieval planner for a hierarchical memory system.

Current time: ${now.toISOString()}

Given the user's message, decide:
1. Which temporal scopes to query (paths)
2. How deep to load (maxDepth)

Temporal paths use this format: year.YYYY.month.MM.week.WW.day.DD
- Week is week-of-month (1-5): Math.ceil(day / 7)
- Always include the current month and year as context paths
- Add specific day/week paths based on the query's temporal references

Depth levels:
- 0 (Theme): 1-sentence abstract essence
- 1 (Gist): 2-3 sentence summary
- 2 (Outline): Bullet-point topic map
- 3 (Entities): Structured JSON with names, tools, decisions, topics
- 4 (Detail): Full paragraphs with specific values preserved
- 5 (Exchanges): Compressed dialog with speaker attribution
- 6 (Raw): Original transcript

Guidelines:
- Default to D1 for general queries
- Use D3-D4 when asking about specific facts, decisions, or entities
- Use D5-D6 only for verbatim recall or decision tracing
- When the query references "earlier today" or "recent", include today's day path
- When the query is vague about time, include the current week's days

Respond with ONLY valid JSON:
{"paths": ["year.2026", "year.2026.month.03", ...], "maxDepth": 3, "reason": "brief explanation"}`;
    }

    // ----------------------------------------------------------------
    //  Rule-based planning (regex fallback)
    // ----------------------------------------------------------------

    /**
     * Plans the retrieval strategy using deterministic regex rules.
     *
     * This is the original planning logic — zero-cost and reliable,
     * used as the fallback when the LLM planner is unavailable or
     * fails. Matches temporal references and specificity signals in
     * the user's message against predefined patterns.
     *
     * @param message - The user's message text.
     * @param now - Reference time for temporal resolution.
     * @returns The rule-determined retrieval plan.
     */
    private planWithRules(message: string, now: Date = new Date()): PlanResult {
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
