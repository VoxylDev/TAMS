import { DEPTH_META } from '@tams/common';

import type TAMS from '@tams/core/tams.js';
import type { MemoryContext } from '@tams/common';

/**
 * Handles the tams_context tool — returns the always-on memory context block.
 *
 * This is called at session start and cached for the duration of the session.
 * Returns a formatted string containing the broadest memory abstractions across
 * the temporal hierarchy plus any recent conversations in the STM buffer.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @returns Formatted context string for prompt injection.
 */
export async function handleContext(userId: string, tams: TAMS): Promise<string> {
    const context = await tams.getContext(userId);

    if (
        context.layers.length === 0 &&
        context.recentConversations.length === 0 &&
        context.recentPrompts.length === 0
    ) {
        return 'No memories stored yet. This is a fresh memory system.';
    }

    return formatContext(context);
}

/**
 * Formats the memory context into a human-readable string
 * suitable for prompt injection.
 *
 * Renders base layers (D0/D1 temporal summaries) and recent conversations
 * (STM buffer entries with device metadata) as distinct sections.
 *
 * @param context - The assembled memory context.
 * @returns Formatted string with temporal labels and content.
 */
function formatContext(context: MemoryContext): string {
    const sections: string[] = [];

    // Format base layers (D0/D1 summaries across temporal levels)
    for (const layer of context.layers) {
        const depthLabel = DEPTH_META[layer.depth].name,
            temporalLabel = `${layer.temporal} (${depthLabel})`;

        sections.push(`[${temporalLabel}] ${layer.content}`);
    }

    // Format STM buffer entries as a "Recent Conversations" section
    if (context.recentConversations.length > 0) {
        sections.push('');
        sections.push('Recent Conversations:');

        const now = Date.now();

        for (const [i, entry] of context.recentConversations.entries()) {
            const age = formatRelativeTime(now, entry.storedAt),
                device = entry.device.name,
                label = `[${i + 1}] (${age}, ${device})`;

            sections.push(`${label} ${entry.content}`);
        }
    }

    // Format user prompts buffer as a "Recent User Prompts" section
    if (context.recentPrompts.length > 0) {
        sections.push('');
        sections.push('Recent User Prompts:');

        const now = Date.now();

        for (const [i, entry] of context.recentPrompts.entries()) {
            const age = formatRelativeTime(now, entry.storedAt),
                device = entry.device.name,
                label = `[${i + 1}] (${age}, ${device})`;

            sections.push(`${label} ${entry.content}`);
        }
    }

    const header = `Memory Context (${context.totalTokens} tokens, ${context.assembledAt}):`;

    return `${header}\n${sections.join('\n')}`;
}

/**
 * Formats a relative time label from a Unix timestamp.
 *
 * @param now - The current Unix timestamp (ms).
 * @param storedAt - The entry's stored-at timestamp (ms).
 * @returns A human-readable relative time string.
 */
function formatRelativeTime(now: number, storedAt: number): string {
    const diffMs = now - storedAt,
        diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;

    const diffHr = Math.floor(diffMin / 60);

    if (diffHr < 24) return `${diffHr} hr ago`;

    const diffDays = Math.floor(diffHr / 24);

    return `${diffDays}d ago`;
}
