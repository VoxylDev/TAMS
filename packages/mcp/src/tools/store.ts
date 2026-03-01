import type TAMS from '@tams/core/tams.js';

/**
 * Handles the tams_store tool — stores a conversation transcript
 * immediately (D6) and queues background consolidation through
 * all 7 abstraction layers.
 *
 * The response is returned within milliseconds. Consolidation
 * (D5 through D0) runs asynchronously in the server's background queue.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @param content - The conversation transcript to store.
 * @param sessionId - Optional session identifier for tracking.
 * @returns A summary of the store result and queue position.
 */
export async function handleStore(
    userId: string,
    tams: TAMS,
    content: string,
    sessionId?: string
): Promise<string> {
    const result = await tams.storeConversation(userId, content, sessionId);

    return [
        `Stored at: ${result.path}`,
        `Consolidation queued (position ${result.queuePosition}).`,
        'Layers D5-D0 will be generated in the background.'
    ].join('\n');
}
