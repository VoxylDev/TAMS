import type TAMS from '@tams/core/tams.js';

/**
 * Handles the tams_search tool — searches entity/theme data
 * across the D3 layer of the memory tree, with fallback to
 * content search on D4/D1 layers when D3 returns nothing.
 *
 * @param userId - The authenticated user's ID.
 * @param tams - The TAMS service instance.
 * @param query - The search term to look for.
 * @param limit - Maximum number of results.
 * @returns Formatted search results.
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

    const isD3 = results[0].depth === 3,
        source = isD3 ? 'entity match' : 'content fallback';

    const lines: string[] = [`Found ${results.length} match(es) for "${query}" (${source}):`];

    for (const node of results) {
        lines.push(`\n[${node.temporal} / ${node.path} / D${node.depth}]`);

        if (isD3) {
            lines.push(`Entities: ${JSON.stringify(node.entities)}`);
        }

        if (node.content) lines.push(`Content: ${node.content.slice(0, 200)}...`);
    }

    return lines.join('\n');
}
