import type TAMS from '@tams/core/tams.js';
import type { EnrichedSearchResult, MemoryNode } from '@tams/common';

/**
 * Type guard to distinguish enriched D3 results from plain fallback nodes.
 *
 * Enriched results have a `match` property containing the D3 node,
 * while fallback results are bare MemoryNode arrays.
 */
function isEnrichedResults(
    results: EnrichedSearchResult[] | MemoryNode[]
): results is EnrichedSearchResult[] {
    return results.length > 0 && 'match' in results[0];
}

/**
 * Handles the tams_search tool — searches entity/theme data
 * across the D3 layer of the memory tree, with fallback to
 * content search on D4/D1 layers when D3 returns nothing.
 *
 * When D3 matches are found, each result is enriched with sibling
 * D1 (gist) and D2 (outline) layers from the same temporal path,
 * giving the agent narrative context alongside the structured entities.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @param query - The search term to look for.
 * @param limit - Maximum number of results.
 * @returns Formatted search results with sibling context.
 */
export async function handleSearch(
    userId: string,
    tams: TAMS,
    query: string,
    limit: number
): Promise<string> {
    const results = await tams.search(userId, query, limit);

    if (results.length === 0) {
        return `No results found.`;
    }

    // Enriched D3 results — show entities with D1/D2 narrative context
    if (isEnrichedResults(results)) {
        const lines: string[] = [
            `Found ${results.length} match(es) for "${query}" (entity match):`
        ];

        for (const result of results) {
            const { match, gist, outline } = result;

            lines.push(`\n[${match.temporal} / ${match.path}]`);
            lines.push(`Entities: ${JSON.stringify(match.entities)}`);

            if (gist) lines.push(`Gist: ${gist}`);

            if (outline) lines.push(`Outline: ${outline}`);
        }

        return lines.join('\n');
    }

    // Plain fallback results — D4/D1 content search (no enrichment)
    const lines: string[] = [
        `Found ${results.length} match(es) for "${query}" (content fallback):`
    ];

    for (const node of results) {
        lines.push(`\n[${node.temporal} / ${node.path} / D${node.depth}]`);

        if (node.content) lines.push(`Content: ${node.content.slice(0, 200)}...`);
    }

    return lines.join('\n');
}
