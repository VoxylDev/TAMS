/**
 * esbuild configuration for @tams/mcp.
 *
 * Bundles the MCP server into a single ESM file in dist/,
 * externalizing native dependencies that can't be bundled.
 */

import esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/main.ts'],
    outdir: 'dist',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    external: ['pg-native'],
    banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
    }
});

console.log('@tams/mcp built successfully.');
