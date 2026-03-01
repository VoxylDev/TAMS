/**
 * TAMS HTTP Server — Entry Point
 *
 * Launches the HTTP API server that wraps the TAMS core engine,
 * allowing remote access from MCP bridge clients.
 */

import { startServer } from './server.js';

startServer().catch((error) => {
    console.error('Failed to start TAMS HTTP server:', error);
    process.exit(1);
});
