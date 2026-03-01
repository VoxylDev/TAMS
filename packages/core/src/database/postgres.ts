import crypto from 'node:crypto';

import pg from 'pg';
import { log } from '@tams/common';

import type {
    DatabaseConfig,
    MemoryNode,
    CreateNodeParams,
    UpdateNodeParams,
    TAMSUser,
    AuthToken,
    CreateUserParams,
    CreateTokenResult
} from '@tams/common';
import type { AbstractionDepth } from '@tams/common';

const { Pool } = pg;

/**
 * PostgreSQL connection manager for the TAMS memory system.
 *
 * Handles connection pooling, schema initialization, and provides
 * typed query methods for memory node CRUD operations. Uses the ltree
 * extension for efficient tree traversal of the temporal hierarchy.
 */
export default class Postgres {
    /** The connection pool shared across all queries. */
    private pool: pg.Pool;

    public constructor(private config: DatabaseConfig) {
        this.pool = new Pool({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password,
            max: config.maxConnections ?? 10
        });
    }

    /**
     * Initializes the database by running all pending migrations.
     * Safe to call multiple times — migrations are idempotent.
     */
    public async initialize(): Promise<void> {
        log.info('Initializing database connection...');

        // Test the connection
        const client = await this.pool.connect();

        try {
            await client.query('SELECT 1');
            log.info('Database connection established.');
        } finally {
            client.release();
        }

        await this.runMigrations();
    }

    /**
     * Inserts a new memory node into the tree.
     *
     * @param userId - The owning user's UUID.
     * @param params - The node creation parameters.
     * @returns The created node with all server-generated fields populated.
     */
    public async insertNode(userId: string, params: CreateNodeParams): Promise<MemoryNode> {
        const result = await this.pool.query<MemoryNodeRow>(
            `INSERT INTO memory_nodes (user_id, path, temporal, depth, parent_id, content, entities, token_count)
             VALUES ($1, $2::ltree, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, path, depth)
             DO UPDATE SET content = EXCLUDED.content,
                           entities = EXCLUDED.entities,
                           token_count = EXCLUDED.token_count,
                           updated_at = now()
             RETURNING *`,
            [
                userId,
                params.path,
                params.temporal,
                params.depth,
                params.parentId ?? null,
                params.content,
                JSON.stringify(params.entities ?? {}),
                params.tokenCount ?? 0
            ]
        );

        return rowToNode(result.rows[0]);
    }

    /**
     * Retrieves a single memory node by its path and depth.
     *
     * @param userId - The owning user's UUID.
     * @param path - The ltree path of the node.
     * @param depth - The abstraction depth.
     * @returns The node, or null if not found.
     */
    public async getNode(
        userId: string,
        path: string,
        depth: AbstractionDepth
    ): Promise<MemoryNode | null> {
        const result = await this.pool.query<MemoryNodeRow>(
            'SELECT * FROM memory_nodes WHERE user_id = $1 AND path = $2::ltree AND depth = $3',
            [userId, path, depth]
        );

        return result.rows[0] ? rowToNode(result.rows[0]) : null;
    }

    /**
     * Retrieves all abstraction layers (D0-D6) for a single temporal node.
     *
     * @param userId - The owning user's UUID.
     * @param path - The ltree path of the temporal node.
     * @returns Array of nodes ordered by depth (D0 first).
     */
    public async getLayerStack(userId: string, path: string): Promise<MemoryNode[]> {
        const result = await this.pool.query<MemoryNodeRow>(
            'SELECT * FROM memory_nodes WHERE user_id = $1 AND path = $2::ltree ORDER BY depth ASC',
            [userId, path]
        );

        return result.rows.map(rowToNode);
    }

    /**
     * Retrieves nodes at a specific depth across multiple paths.
     * Used for building the always-on context from D0/D1 layers.
     *
     * @param userId - The owning user's UUID.
     * @param paths - Array of ltree paths to query.
     * @param maxDepth - Maximum depth to include (inclusive).
     * @returns Array of matching nodes.
     */
    public async getContextLayers(
        userId: string,
        paths: string[],
        maxDepth: AbstractionDepth
    ): Promise<MemoryNode[]> {
        if (paths.length === 0) return [];

        const placeholders = paths.map((_, i) => `$${i + 2}::ltree`).join(', ');
        const result = await this.pool.query<MemoryNodeRow>(
            `SELECT * FROM memory_nodes
             WHERE user_id = $1
               AND path IN (${placeholders})
               AND depth <= $${paths.length + 2}
             ORDER BY path ASC, depth ASC`,
            [userId, ...paths, maxDepth]
        );

        return result.rows.map(rowToNode);
    }

    /**
     * Retrieves all direct children of a temporal node.
     * Uses ltree's descendant operator for efficient tree queries.
     *
     * @param userId - The owning user's UUID.
     * @param parentPath - The ltree path of the parent node.
     * @param depth - Optional: only return children at this depth.
     * @returns Array of child nodes.
     */
    public async getChildren(
        userId: string,
        parentPath: string,
        depth?: AbstractionDepth
    ): Promise<MemoryNode[]> {
        const query =
            depth !== undefined
                ? `SELECT * FROM memory_nodes
               WHERE user_id = $1 AND path <@ $2::ltree AND path != $2::ltree AND depth = $3
               ORDER BY path ASC`
                : `SELECT * FROM memory_nodes
               WHERE user_id = $1 AND path <@ $2::ltree AND path != $2::ltree
               ORDER BY path ASC, depth ASC`;

        const params = depth !== undefined ? [userId, parentPath, depth] : [userId, parentPath];
        const result = await this.pool.query<MemoryNodeRow>(query, params);

        return result.rows.map(rowToNode);
    }

    /**
     * Updates an existing memory node's content and/or metadata.
     *
     * The userId check ensures users can only update their own nodes.
     *
     * @param userId - The owning user's UUID.
     * @param id - The UUID of the node to update.
     * @param params - The fields to update.
     * @returns The updated node, or null if not found.
     */
    public async updateNode(
        userId: string,
        id: string,
        params: UpdateNodeParams
    ): Promise<MemoryNode | null> {
        const sets: string[] = ['updated_at = now()'],
            values: unknown[] = [userId];
        let index = 2;

        if (params.content !== undefined) {
            sets.push(`content = $${index}`);
            values.push(params.content);
            index++;
        }

        if (params.entities !== undefined) {
            sets.push(`entities = $${index}`);
            values.push(JSON.stringify(params.entities));
            index++;
        }

        if (params.tokenCount !== undefined) {
            sets.push(`token_count = $${index}`);
            values.push(params.tokenCount);
            index++;
        }

        if (params.consolidatedAt !== undefined) {
            sets.push(`consolidated_at = $${index}`);
            values.push(params.consolidatedAt);
            index++;
        }

        values.push(id);

        const result = await this.pool.query<MemoryNodeRow>(
            `UPDATE memory_nodes SET ${sets.join(', ')} WHERE user_id = $1 AND id = $${index} RETURNING *`,
            values
        );

        return result.rows[0] ? rowToNode(result.rows[0]) : null;
    }

    /**
     * Searches for memory nodes with matching entities in their D3 layer.
     *
     * @param userId - The owning user's UUID.
     * @param query - A JSONB containment query (e.g. { "tools": ["PostgreSQL"] }).
     * @param limit - Maximum number of results.
     * @returns Matching nodes.
     */
    public async searchEntities(
        userId: string,
        query: Record<string, unknown>,
        limit = 10
    ): Promise<MemoryNode[]> {
        const result = await this.pool.query<MemoryNodeRow>(
            `SELECT * FROM memory_nodes
             WHERE user_id = $1 AND depth = 3 AND entities @> $2
             ORDER BY updated_at DESC
             LIMIT $3`,
            [userId, JSON.stringify(query), limit]
        );

        return result.rows.map(rowToNode);
    }

    /**
     * Searches D3 nodes across multiple entity fields using OR logic.
     *
     * Checks if the query string appears in entities, tools, or topics arrays.
     * Uses JSONB containment (@>) on each field separately, then unions the results.
     *
     * @param userId - The owning user's UUID.
     * @param query - The search string to match against entity fields.
     * @param limit - Maximum number of results.
     * @returns Matching D3 nodes, ordered by most recent first.
     */
    public async searchEntitiesBroad(
        userId: string,
        query: string,
        limit = 10
    ): Promise<MemoryNode[]> {
        const result = await this.pool.query<MemoryNodeRow>(
            `SELECT * FROM memory_nodes
             WHERE user_id = $1 AND depth = 3 AND (
                 entities @> $2::jsonb
                 OR entities @> $3::jsonb
                 OR entities @> $4::jsonb
             )
             ORDER BY updated_at DESC
             LIMIT $5`,
            [
                userId,
                JSON.stringify({ entities: [query] }),
                JSON.stringify({ tools: [query] }),
                JSON.stringify({ topics: [query] }),
                limit
            ]
        );

        return result.rows.map(rowToNode);
    }

    /**
     * Retrieves all D6 (raw transcript) conversation nodes for a user.
     *
     * Used by the reconsolidation pipeline to fetch existing conversation
     * data that needs to be re-processed through the consolidation pipeline.
     *
     * @param userId - The owning user's UUID.
     * @param startDate - Optional: only include conversations created on or after this date.
     * @param endDate - Optional: only include conversations created on or before this date.
     * @returns Array of D6 conversation nodes ordered by creation time.
     */
    public async getConversationTranscripts(
        userId: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<MemoryNode[]> {
        const conditions: string[] = ['user_id = $1', 'depth = $2', 'temporal = $3'],
            values: unknown[] = [userId, 6, 'conversation'];
        let index = 4;

        if (startDate) {
            conditions.push(`created_at >= $${index}`);
            values.push(startDate);
            index++;
        }

        if (endDate) {
            conditions.push(`created_at <= $${index}`);
            values.push(endDate);
            index++;
        }

        const result = await this.pool.query<MemoryNodeRow>(
            `SELECT * FROM memory_nodes
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at ASC`,
            values
        );

        return result.rows.map(rowToNode);
    }

    /**
     * Returns aggregate statistics about the memory tree for a specific user.
     *
     * @param userId - The user's UUID.
     */
    public async getStats(userId: string): Promise<{
        total: number;
        byTemporal: Record<string, number>;
    }> {
        const totalResult = await this.pool.query<{ count: string }>(
            'SELECT COUNT(*) as count FROM memory_nodes WHERE user_id = $1',
            [userId]
        );

        const byTemporalResult = await this.pool.query<{ temporal: string; count: string }>(
            'SELECT temporal, COUNT(*) as count FROM memory_nodes WHERE user_id = $1 GROUP BY temporal',
            [userId]
        );

        const byTemporal: Record<string, number> = {};

        for (const row of byTemporalResult.rows) byTemporal[row.temporal] = Number(row.count);

        return {
            total: Number(totalResult.rows[0].count),
            byTemporal
        };
    }

    // --- Authentication Methods ---

    /**
     * Validates a token hash and returns the owning user.
     *
     * Joins auth_tokens → tams_users and updates the token's last_used
     * timestamp on every successful lookup.
     *
     * @param tokenHash - The SHA-256 hex digest of the bearer token.
     * @returns The owning user, or null if the token is invalid.
     */
    public async getUserByToken(tokenHash: string): Promise<TAMSUser | null> {
        const result = await this.pool.query<TAMSUserRow>(
            `UPDATE auth_tokens SET last_used = now()
             WHERE token_hash = $1
             RETURNING user_id`,
            [tokenHash]
        );

        if (result.rows.length === 0) return null;

        const userId = result.rows[0].user_id;

        const userResult = await this.pool.query<TAMSUserRow>(
            'SELECT * FROM tams_users WHERE id = $1',
            [userId]
        );

        return userResult.rows[0] ? rowToUser(userResult.rows[0]) : null;
    }

    /**
     * Creates a new TAMS user.
     *
     * @param params - The user creation parameters.
     * @returns The created user.
     */
    public async createUser(params: CreateUserParams): Promise<TAMSUser> {
        const result = params.id
            ? await this.pool.query<TAMSUserRow>(
                  `INSERT INTO tams_users (id, name, email) VALUES ($1, $2, $3) RETURNING *`,
                  [params.id, params.name, params.email ?? null]
              )
            : await this.pool.query<TAMSUserRow>(
                  `INSERT INTO tams_users (name, email) VALUES ($1, $2) RETURNING *`,
                  [params.name, params.email ?? null]
              );

        return rowToUser(result.rows[0]);
    }

    /**
     * Creates a new auth token for a user.
     *
     * Generates a cryptographically random token with the `tams_` prefix,
     * stores its SHA-256 hash in the database, and returns the plaintext
     * exactly once. The caller must save it — it cannot be retrieved again.
     *
     * @param userId - The user to create a token for.
     * @param label - A human-readable label for the token.
     * @returns The plaintext token and its persisted metadata.
     */
    public async createToken(userId: string, label: string): Promise<CreateTokenResult> {
        const raw = crypto.randomBytes(48).toString('base64url'),
            token = `tams_${raw}`,
            hash = crypto.createHash('sha256').update(token).digest('hex');

        const result = await this.pool.query<AuthTokenRow>(
            `INSERT INTO auth_tokens (user_id, token_hash, label)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [userId, hash, label]
        );

        return {
            token,
            record: rowToAuthToken(result.rows[0])
        };
    }

    /**
     * Lists all auth tokens for a user (without plaintext).
     *
     * @param userId - The user's UUID.
     * @returns Array of token metadata.
     */
    public async listTokens(userId: string): Promise<AuthToken[]> {
        const result = await this.pool.query<AuthTokenRow>(
            'SELECT * FROM auth_tokens WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );

        return result.rows.map(rowToAuthToken);
    }

    /**
     * Revokes (deletes) an auth token.
     *
     * @param tokenId - The UUID of the token to revoke.
     * @returns True if a token was deleted, false if not found.
     */
    public async revokeToken(tokenId: string): Promise<boolean> {
        const result = await this.pool.query('DELETE FROM auth_tokens WHERE id = $1', [tokenId]);

        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Lists all registered users.
     *
     * @returns Array of all users.
     */
    public async listUsers(): Promise<TAMSUser[]> {
        const result = await this.pool.query<TAMSUserRow>(
            'SELECT * FROM tams_users ORDER BY created_at ASC'
        );

        return result.rows.map(rowToUser);
    }

    /**
     * Gracefully shuts down the connection pool.
     */
    public async close(): Promise<void> {
        await this.pool.end();
        log.info('Database connection pool closed.');
    }

    /**
     * Runs all pending SQL migrations in order.
     * Migration SQL is inlined to work with esbuild bundling.
     */
    private async runMigrations(): Promise<void> {
        const applied = new Set<number>();

        // Check which migrations have already been applied
        try {
            const result = await this.pool.query<{ version: number }>(
                'SELECT version FROM schema_migrations'
            );

            for (const row of result.rows) applied.add(row.version);
        } catch {
            // Table doesn't exist yet — that's fine, we'll create it
        }

        const migrations: [number, string, string][] = [
            [1, '001-initial', MIGRATION_001],
            [2, '002-auth', MIGRATION_002]
        ];

        for (const [version, name, sql] of migrations) {
            if (applied.has(version)) continue;

            log.info(`Running migration ${name}...`);
            await this.pool.query(sql);
            log.info(`Migration ${name} applied successfully.`);
        }

        if (migrations.every(([v]) => applied.has(v))) {
            log.info(`Database schema is up to date (version ${migrations.length}).`);
        }
    }
}

/**
 * Raw TAMS user row shape before type conversion.
 */
interface TAMSUserRow {
    id: string;
    user_id: string;
    name: string;
    email: string | null;
    created_at: Date;
}

/**
 * Converts a raw user row into a typed TAMSUser.
 */
function rowToUser(row: TAMSUserRow): TAMSUser {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        createdAt: row.created_at
    };
}

/**
 * Raw auth token row shape before type conversion.
 */
interface AuthTokenRow {
    id: string;
    user_id: string;
    token_hash: string;
    label: string;
    last_used: Date | null;
    created_at: Date;
}

/**
 * Converts a raw auth token row into a typed AuthToken.
 */
function rowToAuthToken(row: AuthTokenRow): AuthToken {
    return {
        id: row.id,
        userId: row.user_id,
        label: row.label,
        lastUsed: row.last_used,
        createdAt: row.created_at
    };
}

/**
 * Raw database row shape before type conversion.
 */
interface MemoryNodeRow {
    id: string;
    path: string;
    temporal: string;
    depth: number;
    parent_id: string | null;
    content: string;
    entities: Record<string, unknown>;
    token_count: number;
    created_at: Date;
    updated_at: Date;
    consolidated_at: Date | null;
}

/**
 * Converts a raw database row into a typed MemoryNode.
 *
 * @param row - The raw row from pg query result.
 * @returns A properly typed MemoryNode.
 */
function rowToNode(row: MemoryNodeRow): MemoryNode {
    return {
        id: row.id,
        path: row.path,
        temporal: row.temporal as MemoryNode['temporal'],
        depth: row.depth as MemoryNode['depth'],
        parentId: row.parent_id,
        content: row.content,
        entities: row.entities,
        tokenCount: row.token_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        consolidatedAt: row.consolidated_at
    };
}

/**
 * Initial schema migration — inlined for esbuild compatibility.
 * Source of truth is packages/core/src/database/migrations/001-initial.sql.
 */
const MIGRATION_001 = `
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS memory_nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path            ltree NOT NULL,
    temporal        TEXT NOT NULL CHECK (temporal IN ('year', 'month', 'day', 'hour')),
    depth           SMALLINT NOT NULL CHECK (depth BETWEEN 0 AND 6),
    parent_id       UUID REFERENCES memory_nodes(id) ON DELETE SET NULL,
    content         TEXT NOT NULL DEFAULT '',
    entities        JSONB DEFAULT '{}',
    token_count     INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    consolidated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hot_layers
    ON memory_nodes (temporal, depth)
    WHERE depth <= 1;

CREATE INDEX IF NOT EXISTS idx_path
    ON memory_nodes USING GIST (path);

CREATE INDEX IF NOT EXISTS idx_entities
    ON memory_nodes USING GIN (entities)
    WHERE depth = 3;

CREATE INDEX IF NOT EXISTS idx_parent
    ON memory_nodes (parent_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_path_depth
    ON memory_nodes (path, depth);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, name)
VALUES (1, '001-initial')
ON CONFLICT (version) DO NOTHING;
`;

/**
 * Authentication migration — adds users, auth tokens, and user scoping.
 *
 * Creates the users/tokens tables and adds user_id to memory_nodes.
 * Users are created via the admin API after deployment — no seed data here.
 * The old (path, depth) unique index is replaced with (user_id, path, depth).
 */
const MIGRATION_002 = `
-- Users table
CREATE TABLE IF NOT EXISTS tams_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    email       TEXT UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth tokens table (stores SHA-256 hashes, not plaintext)
CREATE TABLE IF NOT EXISTS auth_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES tams_users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL DEFAULT 'default',
    last_used   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_token_hash ON auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_token_user ON auth_tokens (user_id);

-- Add user_id column to memory_nodes
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES tams_users(id);

-- Replace the old unique index with a user-scoped one
DROP INDEX IF EXISTS idx_path_depth;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_path_depth ON memory_nodes (user_id, path, depth);

-- Version record
INSERT INTO schema_migrations (version, name)
VALUES (2, '002-auth')
ON CONFLICT (version) DO NOTHING;
`;
