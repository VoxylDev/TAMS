import Postgres from '../database/postgres.js';

import {
    AbstractionDepth,
    TemporalLevel,
    getCurrentPaths,
    getParentPath,
    getPathLevel,
    parsePath,
    log
} from '@tams/common';

import type {
    MemoryNode,
    CreateNodeParams,
    UpdateNodeParams,
    MemoryContext,
    ContextLayer
} from '@tams/common';

/**
 * High-level memory tree operations built on top of the PostgreSQL layer.
 *
 * Manages the temporal hierarchy (year > month > week > day > conversation) and provides
 * semantic operations like context assembly, ancestor creation, and
 * tree navigation. Each node in the tree holds a 7-layer abstraction stack.
 */
export default class MemoryTree {
    public constructor(private db: Postgres) {}

    /**
     * Stores a memory node and ensures all ancestor nodes exist.
     *
     * When inserting a node at a deep temporal level (e.g. conversation), this
     * method creates any missing parent nodes (day, week, month, year) so the
     * tree remains structurally complete.
     *
     * @param userId - The owning user's UUID.
     * @param params - The node creation parameters.
     * @returns The created node.
     */
    public async store(userId: string, params: CreateNodeParams): Promise<MemoryNode> {
        // Ensure all ancestor nodes exist before inserting
        await this.ensureAncestors(userId, params.path);

        // Link to parent if not explicitly set
        if (!params.parentId) {
            const parentPath = getParentPath(params.path);

            if (parentPath) {
                const parentNode = await this.db.getNode(userId, parentPath, params.depth);

                if (parentNode) params = { ...params, parentId: parentNode.id };
            }
        }

        return this.db.insertNode(userId, params);
    }

    /**
     * Retrieves the full abstraction stack (D0-D6) for a temporal node.
     *
     * @param userId - The owning user's UUID.
     * @param path - The ltree path of the temporal node.
     * @returns Array of nodes ordered by depth, or empty if the path doesn't exist.
     */
    public async getStack(userId: string, path: string): Promise<MemoryNode[]> {
        return this.db.getLayerStack(userId, path);
    }

    /**
     * Retrieves memory at a specific path up to a maximum depth.
     *
     * @param userId - The owning user's UUID.
     * @param path - The ltree path to retrieve from.
     * @param maxDepth - The deepest abstraction layer to include.
     * @returns Array of nodes from D0 up to maxDepth.
     */
    public async retrieve(
        userId: string,
        path: string,
        maxDepth: AbstractionDepth
    ): Promise<MemoryNode[]> {
        const stack = await this.db.getLayerStack(userId, path);

        return stack.filter((node) => node.depth <= maxDepth);
    }

    /**
     * Builds the always-on memory context block.
     *
     * Assembles layers from each temporal level with increasing detail
     * as the scope narrows toward the present:
     *
     * - **Year**: D0 (theme) only
     * - **Month**: D0 (theme) only
     * - **Week**: D0 (theme) + D1 (gist)
     * - **Day**: D0 (theme) + D1 (gist) + D2 (outline)
     *
     * This produces a ~200-500 token block injected into every prompt
     * for baseline personalization. The graduated depth gives agents
     * thin awareness of the broader timeframe while preserving richer
     * detail for recent activity.
     *
     * @param userId - The owning user's UUID.
     * @param now - Reference time for "current" resolution. Defaults to now.
     * @returns The assembled memory context.
     */
    public async getContext(userId: string, now: Date = new Date()): Promise<MemoryContext> {
        const paths = getCurrentPaths(now),
            allPaths = Object.values(paths) as string[];

        // Fetch up to D2 — we filter per-level below
        const nodes = await this.db.getContextLayers(userId, allPaths, AbstractionDepth.D2);

        const layers: ContextLayer[] = [];

        /**
         * Maximum depth to include per temporal level:
         *   Year  → D0 only (theme)
         *   Month → D0 only (theme)
         *   Week  → D0 + D1 (theme + gist)
         *   Day   → D0 + D1 + D2 (theme + gist + outline)
         */
        const maxDepthByLevel: Record<TemporalLevel, AbstractionDepth> = {
            [TemporalLevel.Year]: AbstractionDepth.D0,
            [TemporalLevel.Month]: AbstractionDepth.D0,
            [TemporalLevel.Week]: AbstractionDepth.D1,
            [TemporalLevel.Day]: AbstractionDepth.D2,
            [TemporalLevel.Conversation]: AbstractionDepth.D0
        };

        // Build layers from broadest (year) to narrowest (day)
        for (const [level, path] of Object.entries(paths)) {
            const temporal = level as TemporalLevel,
                levelMaxDepth = maxDepthByLevel[temporal] ?? AbstractionDepth.D0;

            for (const node of nodes) {
                if (node.path !== path) continue;
                if (node.depth > levelMaxDepth) continue;

                if (node.content.trim()) {
                    layers.push({
                        temporal,
                        depth: node.depth,
                        path: node.path,
                        content: node.content
                    });
                }
            }
        }

        // Estimate token count (rough: ~4 chars per token)
        const totalChars = layers.reduce((sum, layer) => sum + layer.content.length, 0),
            totalTokens = Math.ceil(totalChars / 4);

        return {
            layers,
            recentConversations: [],
            recentPrompts: [],
            assembledAt: now.toISOString(),
            totalTokens
        };
    }

    /**
     * Updates an existing node's content with plastic merge semantics.
     *
     * Instead of blindly overwriting, this appends new information
     * to the existing content when appropriate. The actual merge
     * logic is handled by the consolidation pipeline — this method
     * provides the raw update mechanism.
     *
     * @param userId - The owning user's UUID.
     * @param id - The UUID of the node to update.
     * @param params - The fields to update.
     * @returns The updated node, or null if not found.
     */
    public async update(
        userId: string,
        id: string,
        params: UpdateNodeParams
    ): Promise<MemoryNode | null> {
        return this.db.updateNode(userId, id, params);
    }

    /**
     * Gets all child nodes of a temporal node at a specific depth.
     *
     * @param userId - The owning user's UUID.
     * @param parentPath - The ltree path of the parent.
     * @param depth - Only return children at this abstraction depth.
     * @returns Array of child nodes.
     */
    public async getChildrenAtDepth(
        userId: string,
        parentPath: string,
        depth: AbstractionDepth
    ): Promise<MemoryNode[]> {
        return this.db.getChildren(userId, parentPath, depth);
    }

    /**
     * Searches for entities across the D3 layer of the memory tree.
     *
     * @param userId - The owning user's UUID.
     * @param query - JSONB containment query.
     * @param limit - Maximum results.
     * @returns Matching D3 nodes with entity data.
     */
    public async searchEntities(
        userId: string,
        query: Record<string, unknown>,
        limit = 10
    ): Promise<MemoryNode[]> {
        return this.db.searchEntities(userId, query, limit);
    }

    /**
     * Searches D3 nodes across all entity fields (entities, tools, topics).
     *
     * Unlike `searchEntities` which does a single JSONB containment check,
     * this performs an OR across the three main string-array fields so a
     * query like "Kaetram" matches whether it's in entities, tools, or topics.
     *
     * @param userId - The owning user's UUID.
     * @param query - The search string.
     * @param limit - Maximum results.
     * @returns Matching D3 nodes.
     */
    public async searchEntitiesBroad(
        userId: string,
        query: string,
        limit = 10
    ): Promise<MemoryNode[]> {
        return this.db.searchEntitiesBroad(userId, query, limit);
    }

    /**
     * Fallback content search across D4 and D1 layers.
     *
     * Used when D3 entity search returns no results. Searches the
     * content text directly rather than relying on extracted entities.
     *
     * @param userId - The owning user's UUID.
     * @param query - The search string.
     * @param limit - Maximum results.
     * @returns Matching D4/D1 nodes.
     */
    public async searchContentFallback(
        userId: string,
        query: string,
        limit = 10
    ): Promise<MemoryNode[]> {
        return this.db.searchContentFallback(userId, query, limit);
    }

    /**
     * Ensures all ancestor nodes exist for a given path.
     *
     * If a node is being inserted at "year.2026.month.02.week.04.day.28.conv.abc123",
     * this creates empty nodes at "year.2026", "year.2026.month.02",
     * "year.2026.month.02.week.04", and "year.2026.month.02.week.04.day.28"
     * if they don't already exist.
     *
     * @param userId - The owning user's UUID.
     * @param path - The full ltree path whose ancestors should exist.
     */
    private async ensureAncestors(userId: string, path: string): Promise<void> {
        const parsed = parsePath(path);

        if (!parsed) return;

        const ancestorPaths: { path: string; level: TemporalLevel }[] = [];

        // Build the list of ancestor paths from root to just above the target
        let currentPath = getParentPath(path);

        while (currentPath) {
            const level = getPathLevel(currentPath);

            if (level) ancestorPaths.unshift({ path: currentPath, level });

            currentPath = getParentPath(currentPath);
        }

        // Create ancestors in order (root first) if they don't exist
        let parentId: string | null = null;

        for (const ancestor of ancestorPaths) {
            const existing = await this.db.getNode(userId, ancestor.path, AbstractionDepth.D0);

            if (existing) {
                parentId = existing.id;
                continue;
            }

            log.debug(`Creating ancestor node: ${ancestor.path} (${ancestor.level})`);

            const node = await this.db.insertNode(userId, {
                path: ancestor.path,
                temporal: ancestor.level,
                depth: AbstractionDepth.D0,
                parentId,
                content: ''
            });

            parentId = node.id;
        }
    }
}
