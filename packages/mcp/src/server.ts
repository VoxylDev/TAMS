import { handleContext } from './tools/context.js';
import { handleStore } from './tools/store.js';
import { handleRetrieve } from './tools/retrieve.js';
import { handleSearch } from './tools/search.js';
import { handleConsolidate } from './tools/consolidate.js';
import { handleReconsolidate } from './tools/reconsolidate.js';
import { handleStatus } from './tools/status.js';
import { handleGetSTM } from './tools/stm.js';

import { TAMS, loadConfig } from '@tams/core';
import { log } from '@tams/common';
import { z } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Hardcoded user ID for the legacy MCP package (no auth layer).
 * This is Flav's user ID, used to scope all memory operations.
 */
const LEGACY_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Starts the TAMS MCP server with STDIO transport.
 *
 * Initializes the TAMS core engine, registers all 6 memory tools,
 * and begins listening for MCP requests via stdin/stdout.
 */
export async function startServer(): Promise<void> {
    // Initialize the TAMS core engine
    const config = loadConfig(),
        tams = new TAMS(config);

    await tams.initialize();

    // Create the MCP server
    const server = new McpServer({
        name: 'tams-memory',
        version: '0.1.0'
    });

    // --- Tool Registration ---

    // 1. tams_context — Always-on context retrieval
    server.tool(
        'tams_context',
        'Returns the always-on memory context block (~200-400 tokens). ' +
            'Contains D0 summaries across year/month/day and D1 for current day. ' +
            'Call at session start to load persistent memory.',
        async () => ({
            content: [{ type: 'text' as const, text: await handleContext(LEGACY_USER_ID, tams) }]
        })
    );

    // 2. tams_store — Store conversation data
    server.tool(
        'tams_store',
        'Stores a conversation transcript and triggers consolidation into all 7 ' +
            'abstraction layers (D6 raw -> D0 theme). Call at session end to persist memory.',
        {
            content: z.string().describe('The raw conversation transcript to store.'),
            session_id: z.string().optional().describe('Optional session identifier for tracking.')
        },
        async ({ content, session_id }) => ({
            content: [
                {
                    type: 'text' as const,
                    text: await handleStore(LEGACY_USER_ID, tams, content, session_id)
                }
            ]
        })
    );

    // 3. tams_retrieve — Deep retrieval
    server.tool(
        'tams_retrieve',
        'Retrieves memory at a specific temporal scope and depth. ' +
            'Use auto=true to let the retrieval planner decide based on the query.',
        {
            temporal_scope: z
                .string()
                .optional()
                .describe(
                    'ltree path to retrieve from (e.g. "year.2026.month.02.week.04.day.28"). ' +
                        'Defaults to current day.'
                ),
            max_depth: z
                .number()
                .min(0)
                .max(6)
                .optional()
                .describe(
                    'Maximum abstraction depth (0=theme, 1=gist, 2=outline, 3=entities, ' +
                        '4=detail, 5=exchanges, 6=raw). Defaults to 1.'
                ),
            auto: z
                .boolean()
                .optional()
                .describe(
                    'When true, the retrieval planner analyzes the query to determine ' +
                        'optimal temporal scope and depth automatically.'
                ),
            query: z
                .string()
                .optional()
                .describe('The user query text. Used by the retrieval planner when auto=true.')
        },
        async ({ temporal_scope, max_depth, auto, query }) => ({
            content: [
                {
                    type: 'text' as const,
                    text: await handleRetrieve(
                        LEGACY_USER_ID,
                        tams,
                        temporal_scope,
                        max_depth,
                        auto,
                        query
                    )
                }
            ]
        })
    );

    // 4. tams_search — Entity/theme search
    server.tool(
        'tams_search',
        'Searches for entities and topics across the D3 layer of the memory tree. ' +
            'Finds conversations where specific tools, people, or concepts were discussed.',
        {
            query: z.string().describe('The search query (matched against entity data).'),
            limit: z
                .number()
                .min(1)
                .max(50)
                .optional()
                .describe('Maximum number of results. Defaults to 5.')
        },
        async ({ query, limit }) => ({
            content: [
                {
                    type: 'text' as const,
                    text: await handleSearch(LEGACY_USER_ID, tams, query, limit ?? 5)
                }
            ]
        })
    );

    // 5. tams_consolidate — Trigger consolidation
    server.tool(
        'tams_consolidate',
        'Triggers temporal consolidation at a specific level. Merges child nodes ' +
            'into a parent (e.g. conversations->day, days->week). Run after accumulating data.',
        {
            level: z
                .enum(['day', 'week', 'month', 'year'])
                .describe('The temporal level to consolidate.'),
            path: z
                .string()
                .optional()
                .describe(
                    'Specific ltree path to consolidate. ' +
                        'Defaults to current time at the given level.'
                )
        },
        async ({ level, path }) => ({
            content: [
                {
                    type: 'text' as const,
                    text: await handleConsolidate(LEGACY_USER_ID, tams, level, path)
                }
            ]
        })
    );

    // 6. tams_status — System health
    server.tool(
        'tams_status',
        'Returns TAMS system health: database node counts by temporal level, ' +
            'cache hit rate, consolidation token usage, and readiness state.',
        async () => ({
            content: [{ type: 'text' as const, text: await handleStatus(LEGACY_USER_ID, tams) }]
        })
    );

    // 7. tams_stm — Short-term memory buffer read
    server.tool(
        'tams_stm',
        'Read short-term memory buffers: recent conversation summaries and raw user prompts. ' +
            'Returns the contents of the Redis-backed STM buffers with relative timestamps. ' +
            'Call this FIRST when catching up on recent work, before using tams_retrieve or tams_search.',
        {
            buffer: z
                .enum(['conversations', 'prompts', 'both'])
                .optional()
                .describe(
                    'Which buffer to read. "conversations" = stored session summaries, ' +
                        '"prompts" = raw user messages, "both" = everything (default).'
                )
        },
        async ({ buffer }) => ({
            content: [
                {
                    type: 'text' as const,
                    text: await handleGetSTM(LEGACY_USER_ID, tams, buffer)
                }
            ]
        })
    );

    // 8. tams_reconsolidate — Re-run consolidation on existing data
    server.tool(
        'tams_reconsolidate',
        'Re-runs the consolidation pipeline on existing conversation data. ' +
            'Fetches all D6 transcripts and regenerates D5-D0 layers. Idempotent. ' +
            'Use after fixing consolidation bugs to reprocess stale data.',
        {
            start_date: z
                .string()
                .optional()
                .describe(
                    'ISO date string to filter from (e.g. "2026-01-01"). ' +
                        'Omit to include all conversations.'
                ),
            end_date: z
                .string()
                .optional()
                .describe(
                    'ISO date string to filter to (e.g. "2026-03-01"). ' +
                        'Omit to include all conversations.'
                )
        },
        async ({ start_date, end_date }) => ({
            content: [
                {
                    type: 'text' as const,
                    text: await handleReconsolidate(LEGACY_USER_ID, tams, start_date, end_date)
                }
            ]
        })
    );

    // Connect via STDIO transport
    const transport = new StdioServerTransport();

    await server.connect(transport);

    log.info('TAMS MCP server started (STDIO transport).');

    // Graceful shutdown
    process.on('SIGINT', async () => {
        log.info('Received SIGINT, shutting down...');
        await tams.shutdown();
        await server.close();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        log.info('Received SIGTERM, shutting down...');
        await tams.shutdown();
        await server.close();
        process.exit(0);
    });
}
