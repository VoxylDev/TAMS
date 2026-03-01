/**
 * @tams/server — HTTP API for the TAMS memory engine.
 *
 * Exposes all TAMS core operations as REST endpoints, enabling
 * remote MCP bridge clients to communicate over HTTP instead
 * of requiring direct STDIO/SSH access.
 */

export { startServer } from './server.js';
