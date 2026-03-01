import type TAMS from '@tams/core/tams.js';

/**
 * Handles the tams_reconsolidate tool — re-runs the consolidation
 * pipeline on all existing D6 conversation transcripts.
 *
 * Enqueues conversation and temporal consolidation jobs for background
 * processing. The operation is idempotent (safe to run multiple times).
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @param startDate - Optional ISO date string to filter from.
 * @param endDate - Optional ISO date string to filter to.
 * @returns A summary of the queued reconsolidation work.
 */
export async function handleReconsolidate(
    userId: string,
    tams: TAMS,
    startDate?: string,
    endDate?: string
): Promise<string> {
    const start = startDate ? new Date(startDate) : undefined,
        end = endDate ? new Date(endDate) : undefined;

    if (start && isNaN(start.getTime())) return 'Invalid start_date format.';
    if (end && isNaN(end.getTime())) return 'Invalid end_date format.';

    const result = await tams.reconsolidate(userId, start, end);

    if (result.conversationsFound === 0) return 'No conversations found to reconsolidate.';

    const lines = [
        'Reconsolidation queued:',
        `  Conversations found: ${result.conversationsFound}`,
        `  Conversation jobs: ${result.conversationJobsEnqueued}`,
        `  Temporal jobs: ${result.temporalJobsEnqueued}`,
        `  Total jobs: ${result.totalJobsEnqueued}`,
        `  Queue positions: ${result.queuePositionStart}-${result.queuePositionEnd}`,
        '',
        'Temporal paths to reconsolidate:',
        `  Days: ${result.temporalPaths.day.length}`,
        `  Weeks: ${result.temporalPaths.week.length}`,
        `  Months: ${result.temporalPaths.month.length}`,
        `  Years: ${result.temporalPaths.year.length}`,
        '',
        'Processing will run in the background.'
    ];

    return lines.join('\n');
}
