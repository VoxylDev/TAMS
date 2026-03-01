/**
 * @tams/core — The TAMS memory engine.
 *
 * Provides the full memory lifecycle: ingestion, consolidation,
 * retrieval, and caching for the temporal abstraction memory tree.
 */

export { default as TAMS } from './tams.js';
export { loadConfig } from './config.js';

export type { TAMSStatus, ReconsolidationResult } from './tams.js';
export type { ConsolidationResult } from './consolidation/consolidator.js';
export type { PlanResult } from './consolidation/planner.js';
