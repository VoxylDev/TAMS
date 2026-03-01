import { AbstractionDepth, DEPTH_META } from '@tams/common';

/**
 * Consolidation prompt templates for each layer transition.
 *
 * Each prompt enforces strict format contracts per the TAMS design.
 * The consolidation pipeline runs: D6 -> D5 (branch), D6 -> D4 -> D3
 * -> D2 -> D1 -> D0. Both D5 and D4 are generated directly from the
 * raw transcript (D6) to prevent hallucination from cascading lossy
 * compression. D3 onwards compresses from D4.
 *
 * Key principle: names, decisions, and load-bearing facts survive
 * naturally through competent compression. No explicit pinning needed.
 */

/**
 * Builds the system prompt for a specific layer transition.
 *
 * @param fromDepth - The source layer (input).
 * @param toDepth - The target layer (output).
 * @returns The system prompt for the LLM.
 */
export function buildConsolidationPrompt(
    fromDepth: AbstractionDepth,
    toDepth: AbstractionDepth
): string {
    const fromMeta = DEPTH_META[fromDepth],
        toMeta = DEPTH_META[toDepth];

    let base = `You are a memory consolidation agent. Your task is to compress information from one abstraction level to the next.

INPUT: "${fromMeta.name}" layer (${fromMeta.format}) — ${fromMeta.description}
OUTPUT: "${toMeta.name}" layer (${toMeta.format}) — ${toMeta.description}

Rules:
- Preserve all names, tools, technologies, and key decisions. These are load-bearing.
- Preserve the emotional/importance weight of the content. High-stakes decisions get more space.
- Do not invent information. Only compress what is present.
- Output ONLY the compressed content. No preamble, no explanation, no metadata.`;

    // Add layer-specific instructions
    const specific = LAYER_PROMPTS[toDepth];

    if (specific) base += `\n\n${specific}`;

    return base;
}

/**
 * Builds the system prompt for merging multiple nodes at the same
 * temporal level into a single parent node.
 *
 * Used during temporal consolidation (e.g. merging hour nodes into a day).
 *
 * @param toDepth - The target depth for the merged output.
 * @param count - How many child nodes are being merged.
 * @returns The system prompt.
 */
export function buildMergePrompt(toDepth: AbstractionDepth, count: number): string {
    const toMeta = DEPTH_META[toDepth];

    return `You are a memory consolidation agent. You are merging ${count} memory entries from the same time period into a single unified entry.

OUTPUT FORMAT: "${toMeta.name}" layer (${toMeta.format}) — ${toMeta.description}

Rules:
- Combine information from all entries into a coherent whole.
- Where entries cover the same topic, merge them. Newer information takes precedence if there are contradictions.
- Preserve all names, decisions, and important facts across all entries.
- Remove redundancy — if the same fact appears in multiple entries, include it once.
- The merged output should read as one cohesive memory, not a concatenation.
- Output ONLY the merged content. No preamble, no explanation.`;
}

/**
 * Layer-specific consolidation instructions appended to the base prompt.
 */
const LAYER_PROMPTS: Partial<Record<AbstractionDepth, string>> = {
    [AbstractionDepth.D5]: `Specific instructions for the Exchanges layer:
- Strip pleasantries, filler, and repetition from the conversation.
- Preserve the substantive back-and-forth: who said what, in what order.
- Keep the flow of decision-making intact.
- Compress verbose explanations into their core points.
- Maintain speaker attribution where it matters for context.`,

    [AbstractionDepth.D4]: `Specific instructions for the Detail layer:
- Organize by topic. Each distinct topic gets its own paragraph.
- Preserve ALL specific values: numbers, port numbers, file paths, version strings, names, URLs, dollar amounts, percentages, sizes, durations, and configuration details.
- If the source says "128kbps for SFX and 192kbps for music", the output MUST contain "128kbps" and "192kbps". Exact figures are load-bearing.
- Preserve trade-offs and alternatives that were EXPLICITLY discussed. Do not infer reasoning that is not stated.
- Do not elaborate, expand, or add context beyond what is present in the source. Extract, do not generate.
- When in doubt about whether a detail was stated, omit it rather than risk fabrication.`,

    [AbstractionDepth.D3]: `Specific instructions for the Entities layer:
- Extract all named entities: people, tools, technologies, projects, concepts.
- Extract all decisions made and their outcomes.
- Extract all relationships between entities.
- Output as valid JSON with this structure:
{
  "entities": ["name1", "name2"],
  "tools": ["tool1", "tool2"],
  "decisions": [{"decision": "what", "outcome": "result"}],
  "topics": ["topic1", "topic2"],
  "relationships": [{"from": "A", "to": "B", "type": "uses/depends-on/replaces"}]
}
- Be exhaustive. Missing an entity is worse than including a minor one.`,

    [AbstractionDepth.D2]: `Specific instructions for the Outline layer:
- One bullet point per topic discussed.
- Each bullet captures: the topic name and the position/conclusion reached.
- No reasoning, no detail — just the map of what was covered.
- Order bullets by significance, not chronology.
- Use simple dash (-) for bullets.`,

    [AbstractionDepth.D1]: `Specific instructions for the Gist layer:
- Exactly 2-3 sentences. No more, no less.
- First sentence: what was the main activity or topic.
- Second sentence: what was decided or accomplished.
- Optional third sentence: any significant open question or next step.
- This should be the "elevator pitch" of the memory.`,

    [AbstractionDepth.D0]: `Specific instructions for the Theme layer:
- Exactly ONE sentence. No more.
- Capture the abstract essence: the mood, intent, or category.
- A human would express this as completing: "We talked about..."
- Strip all specifics. This is the most zoomed-out view possible.`
};
