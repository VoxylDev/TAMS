import { buildConsolidationPrompt, buildMergePrompt } from './prompts.js';

import MemoryTree from '../tree/tree.js';

import OpenAI from 'openai';
import { AbstractionDepth, TemporalLevel, TEMPORAL_CHILD, log } from '@tams/common';

import type { ConsolidationConfig } from '@tams/common';

/**
 * Default model for consolidation.
 *
 * Uses gpt-4o-mini as the default since it's accessible via the standard
 * OpenAI API. Override with TAMS_LLM_FAST_MODEL / TAMS_LLM_ABSTRACT_MODEL
 * for other providers (Anthropic, Ollama, OpenRouter, etc.).
 */
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Strips markdown code fences from LLM output.
 *
 * LLMs often wrap JSON responses in ```json ... ``` code fences.
 * This extracts the content between the fences so JSON.parse succeeds.
 */
function stripCodeFences(text: string): string {
    const match = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```\s*$/);

    return match ? match[1] : text;
}

/**
 * Minimum token count to consider a conversation worth full consolidation.
 *
 * Set to 30 tokens (~120 chars) to capture brief but valuable interactions
 * like "remember X" requests or quick factual answers. Previously 50, which
 * caused some meaningful short exchanges to be skipped.
 */
const DEFAULT_LOW_SIGNAL_THRESHOLD = 30;

/**
 * Result of a consolidation operation, tracking what was generated.
 */
export interface ConsolidationResult {
    /** The ltree path that was consolidated. */
    path: string;

    /** The temporal level that was consolidated. */
    level: TemporalLevel;

    /** How many depth layers were generated. */
    layersGenerated: number;

    /** Total tokens used across all LLM calls in this consolidation. */
    tokensUsed: number;

    /** Whether the conversation was detected as low-signal and skipped. */
    skipped: boolean;
}

/**
 * The consolidation pipeline — the heart of TAMS.
 *
 * Converts raw conversations into layered abstractions by running
 * sequential LLM calls that progressively compress information from
 * D6 (raw transcript) through D0 (single-sentence theme).
 *
 * Also handles temporal merging: combining multiple child nodes into
 * a single parent node at the next temporal level up.
 */
export default class Consolidator {
    /** OpenAI-compatible client for LLM calls. */
    private client: OpenAI;

    /** Model used for all consolidation passes. */
    private model: string;

    /** Low-signal detection threshold. */
    private lowSignalThreshold: number;

    /** Running total of tokens used across all consolidation calls. */
    private totalTokensUsed = 0;

    public constructor(
        private tree: MemoryTree,
        private config: ConsolidationConfig
    ) {
        this.client = new OpenAI({
            apiKey: config.apiKey,
            ...(config.baseUrl && { baseURL: config.baseUrl })
        });
        this.model = config.fastModel ?? DEFAULT_MODEL;
        this.lowSignalThreshold = config.lowSignalThreshold ?? DEFAULT_LOW_SIGNAL_THRESHOLD;
    }

    /**
     * Consolidates a raw conversation transcript into all 7 abstraction layers.
     *
     * This is the primary entry point after a conversation ends. It takes the
     * raw transcript (D6) and generates D5 through D0 via sequential LLM calls.
     *
     * @param userId - The owning user's UUID.
     * @param path - The ltree path for this conversation's temporal position.
     * @param transcript - The raw conversation transcript (D6 content).
     * @param temporal - The temporal level (typically 'conversation').
     * @returns The consolidation result with stats.
     */
    public async consolidateConversation(
        userId: string,
        path: string,
        transcript: string,
        temporal: TemporalLevel = TemporalLevel.Conversation
    ): Promise<ConsolidationResult> {
        let tokensUsed = 0;

        // Estimate token count for low-signal detection
        const estimatedTokens = Math.ceil(transcript.length / 4);

        if (estimatedTokens < this.lowSignalThreshold) {
            log.info(`Low-signal conversation at ${path} (~${estimatedTokens} tokens), skipping.`);

            // Still store D6 and a minimal D0
            await this.tree.store(userId, {
                path,
                temporal,
                depth: AbstractionDepth.D6,
                content: transcript,
                tokenCount: estimatedTokens
            });

            await this.tree.store(userId, {
                path,
                temporal,
                depth: AbstractionDepth.D0,
                content: 'Brief, low-signal interaction.',
                tokenCount: 5
            });

            return { path, level: temporal, layersGenerated: 2, tokensUsed: 0, skipped: true };
        }

        log.info(`Consolidating conversation at ${path} (~${estimatedTokens} tokens)...`);

        // Store D6 (raw transcript)
        await this.tree.store(userId, {
            path,
            temporal,
            depth: AbstractionDepth.D6,
            content: transcript,
            tokenCount: estimatedTokens
        });

        // Run the compression pipeline.
        //
        // D4 is generated directly from D6 (raw transcript) to avoid
        // hallucination from cascading lossy compression. D3 onwards
        // compresses from D4.
        //
        //   D6 ─→ D4 ─→ D3 ─→ D2 ─→ D1 ─→ D0  (main chain)
        //
        // D5 (Exchanges) is skipped by default — it costs a full LLM call
        // but was never read in practice. The raw D6 transcript serves the
        // same purpose when explicit decision tracing is requested.
        //
        // After D3 is generated, a validation pass checks entity completeness
        // against the D4 content and merges any missing entries.
        let currentContent = transcript,
            layersGenerated = 1, // D6 already stored
            d4Content = ''; // Tracked for D3 entity validation

        const transitions: [AbstractionDepth, AbstractionDepth, boolean][] = [
            [AbstractionDepth.D6, AbstractionDepth.D4, false], // D4 from full raw source
            [AbstractionDepth.D4, AbstractionDepth.D3, false],
            [AbstractionDepth.D3, AbstractionDepth.D2, false],
            [AbstractionDepth.D2, AbstractionDepth.D1, false],
            [AbstractionDepth.D1, AbstractionDepth.D0, false]
        ];

        for (const [fromDepth, toDepth, isBranch] of transitions) {
            // D5 is a branch — after generating it, reset to the original
            // transcript so D4 gets the full raw source.
            const input =
                isBranch || fromDepth === AbstractionDepth.D6 ? transcript : currentContent;

            const prompt = buildConsolidationPrompt(fromDepth, toDepth),
                result = await this.callLLM(prompt, input);

            // Only advance the main chain if this isn't a branch
            if (!isBranch) currentContent = result.content;

            // Capture D4 content for the upcoming D3 validation pass
            if (toDepth === AbstractionDepth.D4) d4Content = currentContent;

            tokensUsed += result.tokensUsed;

            const tokenCount = Math.ceil(currentContent.length / 4);

            // Parse entities JSON for D3
            let entities: Record<string, unknown> = {};

            if (toDepth === AbstractionDepth.D3) {
                try {
                    entities = JSON.parse(stripCodeFences(currentContent));
                } catch {
                    log.warn(`Failed to parse D3 entities JSON at ${path}, storing as-is.`);
                }
            }

            await this.tree.store(userId, {
                path,
                temporal,
                depth: toDepth,
                content: currentContent,
                entities,
                tokenCount
            });

            // After storing D3, validate entity completeness against D4.
            // A lightweight LLM call checks for missing entities and merges
            // any gaps into the existing extraction before downstream layers
            // consume a potentially incomplete D3.
            if (toDepth === AbstractionDepth.D3 && Object.keys(entities).length > 0 && d4Content) {
                const validation = await this.validateD3Entities(d4Content, entities);

                tokensUsed += validation.tokensUsed;

                // If validation found missing entities, re-store the augmented D3
                if (validation.entities !== entities) {
                    entities = validation.entities;

                    const updatedContent = JSON.stringify(entities, null, 2);

                    currentContent = updatedContent;

                    await this.tree.store(userId, {
                        path,
                        temporal,
                        depth: AbstractionDepth.D3,
                        content: updatedContent,
                        entities,
                        tokenCount: Math.ceil(updatedContent.length / 4)
                    });

                    log.info(`D3 validation: augmented entities at ${path}.`);
                }
            }

            layersGenerated++;
        }

        this.totalTokensUsed += tokensUsed;
        log.info(
            `Consolidation complete for ${path}: ${layersGenerated} layers, ${tokensUsed} tokens.`
        );

        return { path, level: temporal, layersGenerated, tokensUsed, skipped: false };
    }

    /**
     * Merges child nodes into a parent temporal node.
     *
     * Used for temporal consolidation: merging hours into a day,
     * days into a month, months into a year.
     *
     * @param userId - The owning user's UUID.
     * @param parentPath - The ltree path of the parent node to create/update.
     * @param parentLevel - The temporal level of the parent.
     * @returns The consolidation result.
     */
    public async consolidateTemporal(
        userId: string,
        parentPath: string,
        parentLevel: TemporalLevel
    ): Promise<ConsolidationResult> {
        const childLevel = TEMPORAL_CHILD[parentLevel];

        if (!childLevel) {
            log.warn(`Cannot consolidate below ${parentLevel}, it has no children.`);

            return {
                path: parentPath,
                level: parentLevel,
                layersGenerated: 0,
                tokensUsed: 0,
                skipped: true
            };
        }

        log.info(`Temporal consolidation: merging ${childLevel} nodes into ${parentPath}...`);

        let tokensUsed = 0,
            layersGenerated = 0;

        // For each abstract depth (D0-D4), merge children's content at that depth
        const depthsToMerge: AbstractionDepth[] = [
            AbstractionDepth.D0,
            AbstractionDepth.D1,
            AbstractionDepth.D2,
            AbstractionDepth.D3,
            AbstractionDepth.D4
        ];

        for (const depth of depthsToMerge) {
            const children = await this.tree.getChildrenAtDepth(userId, parentPath, depth);

            if (children.length === 0) continue;

            // Collect non-empty content from children
            const contents = children.filter((c) => c.content.trim()).map((c) => c.content);

            if (contents.length === 0) continue;

            // If only one child has content, use it directly
            let mergedContent: string;

            if (contents.length === 1) {
                mergedContent = contents[0];
            } else {
                // Merge via LLM — D3 entity merges need more tokens because
                // they combine structured JSON from many conversations.
                const prompt = buildMergePrompt(depth, contents.length),
                    input = contents.map((c, i) => `--- Entry ${i + 1} ---\n${c}`).join('\n\n'),
                    maxTokens = depth === AbstractionDepth.D3 ? 16384 : 4096,
                    result = await this.callLLM(prompt, input, maxTokens);

                mergedContent = result.content;
                tokensUsed += result.tokensUsed;
            }

            // Parse entities for D3
            let entities: Record<string, unknown> = {};

            if (depth === AbstractionDepth.D3) {
                try {
                    entities = JSON.parse(stripCodeFences(mergedContent));
                } catch {
                    log.warn(`Failed to parse merged D3 entities at ${parentPath}.`);
                }
            }

            await this.tree.store(userId, {
                path: parentPath,
                temporal: parentLevel,
                depth,
                content: mergedContent,
                entities,
                tokenCount: Math.ceil(mergedContent.length / 4)
            });

            layersGenerated++;
        }

        this.totalTokensUsed += tokensUsed;
        log.info(
            `Temporal consolidation complete for ${parentPath}: ` +
                `${layersGenerated} layers, ${tokensUsed} tokens.`
        );

        return {
            path: parentPath,
            level: parentLevel,
            layersGenerated,
            tokensUsed,
            skipped: false
        };
    }

    /**
     * Returns the total tokens used across all consolidation operations.
     */
    public getTotalTokensUsed(): number {
        return this.totalTokensUsed;
    }

    /**
     * Validates D3 entity extraction against D4 content.
     *
     * Sends a lightweight LLM call to check if any entities, tools, or
     * topics mentioned in D4 are missing from the D3 extraction. If gaps
     * are found, returns a merged JSON with the missing entries added.
     *
     * The validation prompt asks the LLM to be conservative — only genuinely
     * missing items are flagged, not synonyms or variants of existing entries.
     *
     * @param d4Content - The D4 (Detail) layer content to validate against.
     * @param d3Json - The extracted D3 entities JSON object.
     * @returns The validated (possibly augmented) D3 JSON, and tokens used.
     */
    private async validateD3Entities(
        d4Content: string,
        d3Json: Record<string, unknown>
    ): Promise<{ entities: Record<string, unknown>; tokensUsed: number }> {
        const validationPrompt = [
            'You are a memory entity validator. Compare the extracted entities against the source material and find anything missing.',
            '',
            'SOURCE (Detail layer):',
            d4Content,
            '',
            'EXTRACTED ENTITIES:',
            JSON.stringify(d3Json, null, 2),
            '',
            'Check for:',
            '1. Named entities (people, projects, services) mentioned in the source but missing from "entities"',
            '2. Tools/technologies mentioned in the source but missing from "tools"',
            '3. Topics discussed in the source but missing from "topics"',
            '4. Decisions described in the source but missing from "decisions"',
            '',
            'If everything is complete, respond with exactly: {"complete": true}',
            'If there are missing items, respond with ONLY the missing items in this format:',
            '{',
            '  "complete": false,',
            '  "missing_entities": ["name1"],',
            '  "missing_tools": ["tool1"],',
            '  "missing_topics": ["topic1"],',
            '  "missing_decisions": [{"decision": "what", "outcome": "result"}]',
            '}',
            '',
            'Be thorough but conservative — only flag genuinely missing items, not synonyms or variants of existing entries.'
        ].join('\n');

        const result = await this.callLLM(
            'You are a precise entity validation assistant. Respond only with JSON.',
            validationPrompt,
            2048
        );

        try {
            const validation = JSON.parse(stripCodeFences(result.content));

            // Nothing missing — return the original D3 as-is
            if (validation.complete === true) {
                return { entities: d3Json, tokensUsed: result.tokensUsed };
            }

            // Merge missing items into the existing D3 JSON
            const merged = { ...d3Json };

            const mergeArray = (key: string, missingKey: string): void => {
                const existing = Array.isArray(merged[key]) ? (merged[key] as unknown[]) : [];
                const missing = Array.isArray(validation[missingKey])
                    ? (validation[missingKey] as unknown[])
                    : [];

                if (missing.length > 0) {
                    merged[key] = [...existing, ...missing];
                }
            };

            mergeArray('entities', 'missing_entities');
            mergeArray('tools', 'missing_tools');
            mergeArray('topics', 'missing_topics');
            mergeArray('decisions', 'missing_decisions');

            return { entities: merged, tokensUsed: result.tokensUsed };
        } catch {
            // If validation response is unparseable, keep the original D3
            log.warn('D3 validation response was not valid JSON, keeping original extraction.');

            return { entities: d3Json, tokensUsed: result.tokensUsed };
        }
    }

    /**
     * Makes an LLM call for consolidation.
     *
     * Uses the OpenAI-compatible chat completions API, which works with
     * OpenAI, Anthropic, Ollama, OpenRouter, Together, vLLM, and more.
     *
     * @param systemPrompt - The system prompt defining the consolidation task.
     * @param content - The input content to consolidate.
     * @param maxTokens - Maximum tokens in the response.
     * @returns The generated content and token usage.
     */
    private async callLLM(
        systemPrompt: string,
        content: string,
        maxTokens = 4096
    ): Promise<{ content: string; tokensUsed: number }> {
        const response = await this.client.chat.completions.create({
            model: this.model,
            max_tokens: maxTokens,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content }
            ]
        });

        const text = response.choices[0]?.message?.content ?? '';

        const tokensUsed =
            (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

        return { content: text, tokensUsed };
    }
}
