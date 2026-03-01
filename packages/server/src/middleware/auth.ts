/**
 * Bearer token authentication middleware for the TAMS HTTP server.
 *
 * Extracts the `Authorization: Bearer tams_...` header, hashes the
 * token with SHA-256, and validates it against the database. On success,
 * the authenticated user's ID and full record are set on the Hono
 * context for downstream handlers.
 *
 * The `/health` endpoint is excluded from authentication so that
 * load balancers and monitoring tools can probe the server freely.
 */

import crypto from 'node:crypto';

import type { Context, Next } from 'hono';
import type { TAMSUser } from '@tams/common';

/**
 * Extends the Hono context with authentication state.
 *
 * After the auth middleware runs, `c.get('userId')` returns the
 * authenticated user's UUID and `c.get('userName')` returns their name.
 */
export interface AuthVariables {
    userId: string;
    userName: string;
}

/**
 * Function signature for validating a token hash against the database.
 * Returns the owning user if valid, or null if the token is invalid/revoked.
 */
export type ValidateTokenFn = (tokenHash: string) => Promise<TAMSUser | null>;

/**
 * Creates an auth middleware that validates bearer tokens.
 *
 * @param validateToken - A function that validates a SHA-256 token hash and returns the user.
 * @returns A Hono middleware function.
 */
export function createAuthMiddleware(validateToken: ValidateTokenFn) {
    return async (c: Context, next: Next) => {
        // Skip auth for health checks (load balancers, monitoring)
        if (c.req.path === '/health') return next();

        const header = c.req.header('Authorization');

        if (!header || !header.startsWith('Bearer ')) {
            return c.json({ error: 'Missing or invalid Authorization header' }, 401);
        }

        const token = header.slice(7); // Strip "Bearer " prefix

        if (!token.startsWith('tams_')) {
            return c.json({ error: 'Invalid token format' }, 401);
        }

        const hash = crypto.createHash('sha256').update(token).digest('hex'),
            user = await validateToken(hash);

        if (!user) {
            return c.json({ error: 'Invalid or revoked token' }, 401);
        }

        c.set('userId', user.id);
        c.set('userName', user.name);

        return next();
    };
}
