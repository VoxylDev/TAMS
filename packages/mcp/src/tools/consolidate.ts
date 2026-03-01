import type TAMS from '@tams/core/tams.js';
import type { TemporalLevel } from '@tams/common';

/** Valid temporal level strings accepted by the tool. */
const VALID_LEVELS = new Set(['day', 'month', 'year']);

/**
 * Handles the tams_consolidate tool — queues temporal consolidation
 * at a specific level for background processing.
 *
 * Merges child nodes into the parent node. For example, triggering
 * "day" merges all conversation-level summaries into day-level summaries.
 *
 * Returns immediately with the queue position. The actual consolidation
 * runs asynchronously in the server's background queue.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @param level - The temporal level to consolidate (day, month, year).
 * @param path - Optional specific path. Defaults to current time.
 * @returns A summary of the queue result.
 */
export async function handleConsolidate(
    userId: string,
    tams: TAMS,
    level: string,
    path?: string
): Promise<string> {
    if (!VALID_LEVELS.has(level)) {
        return `Invalid level "${level}". Must be one of: day, month, year.`;
    }

    const result = await tams.triggerConsolidation(userId, level as TemporalLevel, path);

    return [
        `Queued consolidation for: ${result.path}`,
        `Queue position: ${result.queuePosition}`,
        'Consolidation will run in the background.'
    ].join('\n');
}
