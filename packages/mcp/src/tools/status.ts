import type TAMS from '@tams/core/tams.js';

/**
 * Returns the current TAMS system status.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @returns JSON-formatted status string.
 */
export async function handleStatus(userId: string, tams: TAMS): Promise<string> {
    const status = await tams.getStatus(userId);

    return JSON.stringify(status, null, 2);
}
