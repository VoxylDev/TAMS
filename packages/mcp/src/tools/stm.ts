import type TAMS from '@tams/core/tams.js';
import type { STMEntry, PromptEntry } from '@tams/common';

/**
 * Handles the tams_stm tool — returns the contents of the short-term memory buffers.
 *
 * STM holds recent conversation summaries and raw user prompts in Redis,
 * providing fast recall of what was discussed recently without needing
 * to query the consolidated abstraction layers.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @param buffer - Which buffer to return: "conversations", "prompts", or "both" (default).
 * @returns Formatted string with numbered entries and relative timestamps.
 */
export async function handleGetSTM(userId: string, tams: TAMS, buffer?: string): Promise<string> {
    const target = buffer ?? 'both';

    let conversations: STMEntry[] = [],
        prompts: PromptEntry[] = [];

    if (target === 'both') {
        [conversations, prompts] = await Promise.all([
            tams.getSTMEntries(userId),
            tams.getPromptEntries(userId)
        ]);
    } else if (target === 'conversations') {
        conversations = await tams.getSTMEntries(userId);
    } else {
        prompts = await tams.getPromptEntries(userId);
    }

    if (conversations.length === 0 && prompts.length === 0) {
        return 'STM buffers are empty. No recent conversations or prompts stored.';
    }

    return formatSTM(conversations, prompts);
}

/**
 * Formats STM buffer contents into a human-readable string.
 *
 * @param conversations - Recent conversation summary entries.
 * @param prompts - Recent raw user prompt entries.
 * @returns Formatted multi-section string.
 */
function formatSTM(conversations: STMEntry[], prompts: PromptEntry[]): string {
    const sections: string[] = [],
        now = Date.now();

    // Header with counts
    const parts: string[] = [];

    if (conversations.length > 0) parts.push(`${conversations.length} conversations`);
    if (prompts.length > 0) parts.push(`${prompts.length} prompts`);

    sections.push(`STM buffers (${parts.join(', ')})`);

    // Conversation entries
    if (conversations.length > 0) {
        sections.push('');
        sections.push(`Recent Conversations (${conversations.length} entries):`);

        for (const [i, entry] of conversations.entries()) {
            const age = formatRelativeTime(now, entry.storedAt),
                device = entry.device.name,
                label = `\n[${i + 1}] (${age}, ${device})`;

            sections.push(`${label}\n${entry.content}`);
        }
    }

    // Prompt entries
    if (prompts.length > 0) {
        sections.push('');
        sections.push(`Recent User Prompts (${prompts.length} entries):`);

        for (const [i, entry] of prompts.entries()) {
            const age = formatRelativeTime(now, entry.storedAt),
                device = entry.device.name;

            sections.push(`[${i + 1}] (${age}, ${device}) ${entry.content}`);
        }
    }

    return sections.join('\n');
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
