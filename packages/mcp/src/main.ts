/**
 * TAMS MCP Server — Entry Point
 *
 * Launches the MCP server with STDIO transport, connecting
 * to the TAMS memory engine for persistent AI agent memory.
 */

import { startServer } from './server.js';

startServer().catch((error) => {
    console.error('Failed to start TAMS MCP server:', error);
    process.exit(1);
});
