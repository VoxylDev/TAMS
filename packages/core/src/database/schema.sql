-- TAMS Memory Schema
-- Requires PostgreSQL 16+ with the ltree extension.

CREATE EXTENSION IF NOT EXISTS ltree;

-- The primary memory storage table. Each row represents a single node
-- in the temporal-abstraction tree. A node is uniquely identified by its
-- ltree path and abstraction depth.
CREATE TABLE IF NOT EXISTS memory_nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path            ltree NOT NULL,
    temporal        TEXT NOT NULL CHECK (temporal IN ('year', 'month', 'week', 'day', 'conversation')),
    depth           SMALLINT NOT NULL CHECK (depth BETWEEN 0 AND 6),
    parent_id       UUID REFERENCES memory_nodes(id) ON DELETE SET NULL,
    content         TEXT NOT NULL DEFAULT '',
    entities        JSONB NOT NULL DEFAULT '{}',
    token_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    consolidated_at TIMESTAMPTZ,

    -- A path+depth pair must be unique — only one D2 for "year.2026.month.02"
    CONSTRAINT uq_path_depth UNIQUE (path, depth)
);

-- Hot layer index: fast retrieval of D0/D1 across all temporal levels.
-- These are the "always-on" context layers served from cache.
CREATE INDEX IF NOT EXISTS idx_hot_layers
    ON memory_nodes (temporal, depth) WHERE depth <= 1;

-- Tree navigation index: enables ltree ancestor/descendant queries
-- (e.g. "find all nodes under year.2026.month.02").
CREATE INDEX IF NOT EXISTS idx_path
    ON memory_nodes USING GIST (path);

-- Entity search index: allows JSONB containment queries on the D3 layer
-- (e.g. "find all nodes mentioning entity X").
CREATE INDEX IF NOT EXISTS idx_entities
    ON memory_nodes USING GIN (entities) WHERE depth = 3;

-- Parent lookup index: fast traversal from child to parent.
CREATE INDEX IF NOT EXISTS idx_parent
    ON memory_nodes (parent_id);

-- Temporal ordering index: retrieve nodes in chronological order
-- within a given path prefix.
CREATE INDEX IF NOT EXISTS idx_created
    ON memory_nodes (created_at);
