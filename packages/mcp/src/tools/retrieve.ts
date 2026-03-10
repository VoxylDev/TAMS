import { DEPTH_META } from '@tams/common';

import type TAMS from '@tams/core/tams.js';
import type { AbstractionDepth } from '@tams/common';

/**
 * Handles the tams_retrieve tool — retrieves memory at a specific
 * temporal scope and abstraction depth.
 *
 * When auto mode is enabled, the retrieval planner analyzes the query
 * to determine optimal scope and depth automatically.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @param temporalScope - Optional ltree path (e.g. "year.2026.month.02.week.04.day.28").
 * @param maxDepth - Maximum depth to load (0-6).
 * @param auto - If true, planner decides scope/depth from query.
 * @param query - The user's query text (used when auto=true).
 * @returns Formatted memory content.
 */
export async function handleRetrieve(
    userId: string,
    tams: TAMS,
    temporalScope?: string,
    maxDepth?: number,
    auto?: boolean,
    query?: string
): Promise<string> {
    const result = await tams.retrieve(userId, {
        temporalPath: temporalScope,
        maxDepth: maxDepth as AbstractionDepth | undefined,
        auto,
        query
    });

    if (result.layers.length === 0) {
        return `No memories found at ${result.resolvedPath} (depth ${result.maxDepthLoaded}).`;
    }

    const lines: string[] = [
        `Retrieved ${result.layers.length} layers from: ${result.resolvedPaths?.join(', ') ?? result.resolvedPath} (source: ${result.source})`,
        `Max depth loaded: D${result.maxDepthLoaded} (${DEPTH_META[result.maxDepthLoaded].name})`,
        '---'
    ];

    for (const layer of result.layers) {
        const depthName = DEPTH_META[layer.depth].name;

        lines.push(`[${layer.temporal} / ${depthName}] ${layer.path}`);
        lines.push(layer.content);
        lines.push('');
    }

    return lines.join('\n');
}
