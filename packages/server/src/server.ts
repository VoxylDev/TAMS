/**
 * TAMS HTTP Server
 *
 * Wraps the TAMS core engine with a Hono HTTP server, exposing
 * all memory operations as REST endpoints. Token-based authentication
 * is required for all endpoints except /health.
 *
 * Endpoints:
 *   GET  /health           — Health check (no auth)
 *   GET  /status           — System stats
 *   GET  /context          — Always-on memory context
 *   POST /store            — Store a conversation transcript
 *   POST /retrieve         — Retrieve memory at a temporal scope
 *   POST /search           — Search entities across memory
 *   POST /consolidate      — Trigger temporal consolidation
 *   POST /prompt/store     — Store a user prompt
 *   GET  /prompts          — List buffered user prompts
 *   POST /prompts/clear    — Clear the prompts buffer
 *   GET  /stm              — List STM buffer entries
 *   POST /stm/clear        — Clear the STM buffer
 *
 * Admin Endpoints:
 *   POST   /admin/users           — Create a user
 *   GET    /admin/users           — List all users
 *   POST   /admin/tokens          — Generate an auth token
 *   GET    /admin/tokens/:userId  — List tokens for a user
 *   DELETE /admin/tokens/:tokenId — Revoke an auth token
 */

import { createAuthMiddleware } from './middleware/auth.js';

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { TAMS, loadConfig } from '@tams/core';
import { log } from '@tams/common';

import type { TemporalLevel } from '@tams/common';
import type { AuthVariables } from './middleware/auth.js';

/** Hono app with typed auth variables available on context. */
type AuthApp = Hono<{ Variables: AuthVariables }>;

/** Default port for the TAMS HTTP server. */
const DEFAULT_PORT = 3100;

/**
 * Starts the TAMS HTTP server.
 *
 * Initializes the core engine, registers auth middleware and all routes,
 * and begins listening for HTTP requests.
 */
export async function startServer(): Promise<void> {
    const config = loadConfig(),
        tams = new TAMS(config);

    await tams.initialize();

    const db = tams.getDatabase(),
        app: AuthApp = new Hono(),
        port = Number.parseInt(process.env.TAMS_SERVER_PORT ?? String(DEFAULT_PORT), 10);

    // --- Auth Middleware ---

    app.use(
        '*',
        createAuthMiddleware((hash) => db.getUserByToken(hash))
    );

    // --- Health ---

    app.get('/health', (c) => c.json({ status: 'ok', service: 'tams', version: '0.2.0' }));

    // --- Status ---

    app.get('/status', async (c) => {
        const userId = c.get('userId'),
            status = await tams.getStatus(userId);

        return c.json(status);
    });

    // --- Context ---

    app.get('/context', async (c) => {
        const userId = c.get('userId'),
            context = await tams.getContext(userId);

        return c.json(context);
    });

    // --- Store ---

    app.post('/store', async (c) => {
        const userId = c.get('userId'),
            body = await c.req.json<{
                content: string;
                session_id?: string;
                device?: { name: string; hostname: string; platform: string };
            }>();

        if (!body.content) return c.json({ error: 'Missing required field: content' }, 400);

        const result = await tams.storeConversation(
            userId,
            body.content,
            body.session_id,
            body.device
        );

        return c.json(result);
    });

    // --- Retrieve ---

    app.post('/retrieve', async (c) => {
        const userId = c.get('userId'),
            body = await c.req.json<{
                temporal_scope?: string;
                max_depth?: number;
                auto?: boolean;
                query?: string;
            }>();

        const result = await tams.retrieve(userId, {
            temporalPath: body.temporal_scope,
            maxDepth: body.max_depth,
            auto: body.auto,
            query: body.query
        });

        return c.json(result);
    });

    // --- Search ---

    app.post('/search', async (c) => {
        const userId = c.get('userId'),
            body = await c.req.json<{ query: string; limit?: number }>();

        if (!body.query) return c.json({ error: 'Missing required field: query' }, 400);

        const results = await tams.search(userId, body.query, body.limit ?? 5);

        return c.json({ results });
    });

    // --- Consolidate ---

    app.post('/consolidate', async (c) => {
        const userId = c.get('userId'),
            body = await c.req.json<{ level: TemporalLevel; path?: string }>();

        if (!body.level) return c.json({ error: 'Missing required field: level' }, 400);

        const result = await tams.triggerConsolidation(userId, body.level, body.path);

        return c.json(result);
    });

    // --- STM Buffer ---

    app.get('/stm', async (c) => {
        const userId = c.get('userId'),
            entries = await tams.getSTMEntries(userId);

        return c.json({ entries, count: entries.length });
    });

    app.post('/stm/clear', async (c) => {
        const userId = c.get('userId');

        await tams.clearSTM(userId);

        return c.json({ cleared: true });
    });

    // --- Prompt Store ---

    app.post('/prompt/store', async (c) => {
        const userId = c.get('userId'),
            body = await c.req.json<{
                content: string;
                session_id?: string;
                device?: { name: string; hostname: string; platform: string };
            }>();

        if (!body.content) return c.json({ error: 'Missing required field: content' }, 400);

        const result = await tams.storePrompt(userId, body.content, body.session_id, body.device);

        return c.json(result);
    });

    // --- Prompts Buffer ---

    app.get('/prompts', async (c) => {
        const userId = c.get('userId'),
            entries = await tams.getPromptEntries(userId);

        return c.json({ entries, count: entries.length });
    });

    app.post('/prompts/clear', async (c) => {
        const userId = c.get('userId');

        await tams.clearPrompts(userId);

        return c.json({ cleared: true });
    });

    // --- Admin: Users ---

    app.post('/admin/users', async (c) => {
        const body = await c.req.json<{ name: string; email?: string }>();

        if (!body.name) return c.json({ error: 'Missing required field: name' }, 400);

        const user = await db.createUser({ name: body.name, email: body.email });

        return c.json(user, 201);
    });

    app.get('/admin/users', async (c) => {
        const users = await db.listUsers();

        return c.json({ users });
    });

    // --- Admin: Tokens ---

    app.post('/admin/tokens', async (c) => {
        const body = await c.req.json<{ user_id: string; label?: string }>();

        if (!body.user_id) return c.json({ error: 'Missing required field: user_id' }, 400);

        const result = await db.createToken(body.user_id, body.label ?? 'default');

        return c.json(result, 201);
    });

    app.get('/admin/tokens/:userId', async (c) => {
        const targetUserId = c.req.param('userId'),
            tokens = await db.listTokens(targetUserId);

        return c.json({ tokens });
    });

    app.delete('/admin/tokens/:tokenId', async (c) => {
        const tokenId = c.req.param('tokenId'),
            revoked = await db.revokeToken(tokenId);

        if (!revoked) return c.json({ error: 'Token not found' }, 404);

        return c.json({ revoked: true });
    });

    // --- Admin: Reconsolidate ---

    app.post('/admin/reconsolidate', async (c) => {
        const userId = c.get('userId'),
            body = (await c.req.json().catch(() => ({}))) as {
                start_date?: string;
                end_date?: string;
            };

        const startDate = body.start_date ? new Date(body.start_date) : undefined,
            endDate = body.end_date ? new Date(body.end_date) : undefined;

        if (startDate && isNaN(startDate.getTime()))
            return c.json({ error: 'Invalid start_date format' }, 400);

        if (endDate && isNaN(endDate.getTime()))
            return c.json({ error: 'Invalid end_date format' }, 400);

        const result = await tams.reconsolidate(userId, startDate, endDate);

        return c.json(result);
    });

    // --- Global error handler ---

    app.onError((error, c) => {
        log.error(`HTTP error: ${error.message}`);

        return c.json({ error: error.message }, 500);
    });

    // --- Start listening ---

    serve({ fetch: app.fetch, port }, () => {
        log.info(`TAMS HTTP server listening on port ${port}.`);
    });

    // --- Graceful shutdown ---

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.on(signal, async () => {
            log.info(`Received ${signal}, shutting down...`);
            await tams.shutdown();
            process.exit(0);
        });
    }
}
