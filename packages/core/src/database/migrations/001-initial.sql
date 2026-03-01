-- TAMS Initial Schema
-- Creates the ltree extension and memory_nodes table with all indexes.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS memory_nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path            ltree NOT NULL,
    temporal        TEXT NOT NULL CHECK (temporal IN ('year', 'month', 'week', 'day', 'conversation')),
    depth           SMALLINT NOT NULL CHECK (depth BETWEEN 0 AND 6),
    parent_id       UUID REFERENCES memory_nodes(id) ON DELETE SET NULL,
    content         TEXT NOT NULL DEFAULT '',
    entities        JSONB DEFAULT '{}',
    token_count     INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    consolidated_at TIMESTAMPTZ
);

-- Hot path: instant retrieval of top abstraction layers (D0/D1).
-- These are the always-on context layers served from cache.
CREATE INDEX IF NOT EXISTS idx_hot_layers
    ON memory_nodes (temporal, depth)
    WHERE depth <= 1;

-- Tree traversal via ltree GIST index.
-- Enables efficient ancestor/descendant queries on the temporal tree.
CREATE INDEX IF NOT EXISTS idx_path
    ON memory_nodes USING GIST (path);

-- Entity search within the D3 structured layer.
-- Enables JSON path queries against extracted entities.
CREATE INDEX IF NOT EXISTS idx_entities
    ON memory_nodes USING GIN (entities)
    WHERE depth = 3;

-- Parent lookup for upward tree traversal.
CREATE INDEX IF NOT EXISTS idx_parent
    ON memory_nodes (parent_id);

-- Unique constraint: only one node per path+depth combination.
-- Each temporal position has exactly one content entry per abstraction level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_path_depth
    ON memory_nodes (path, depth);

-- Schema versioning table for tracking applied migrations.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, name)
VALUES (1, '001-initial')
ON CONFLICT (version) DO NOTHING;
