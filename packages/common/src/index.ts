/**
 * @tams/common — Shared types, enums, and utilities for the TAMS memory system.
 *
 * This package provides the foundational type definitions used across
 * both the core memory engine and the MCP server interface.
 */

// Enums
export * from './enums/depth.js';
export * from './enums/temporal.js';

// Types
export type { MemoryNode, CreateNodeParams, UpdateNodeParams } from './types/node.js';

export type {
    ContextLayer,
    MemoryContext,
    RetrievalRequest,
    RetrievalResult
} from './types/context.js';

export type {
    DatabaseConfig,
    RedisConfig,
    ConsolidationConfig,
    TAMSConfig
} from './types/config.js';

export type { DeviceInfo, STMEntry, STMConfig, PromptEntry } from './types/stm.js';

export type { TAMSUser, AuthToken, CreateUserParams, CreateTokenResult } from './types/auth.js';

// Utilities
export {
    buildPath,
    buildPathFromDate,
    parsePath,
    getParentPath,
    getPathLevel,
    getCurrentPaths
} from './util/path.js';

export type { ParsedPath } from './util/path.js';

export { default as log } from './util/log.js';
export type { LogLevel } from './util/log.js';
