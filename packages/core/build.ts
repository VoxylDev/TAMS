/**
 * esbuild configuration for @tams/core.
 *
 * Bundles the core package into a single ESM file in dist/,
 * externalizing native dependencies that can't be bundled.
 */

import esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/index.ts'],
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

console.log('@tams/core built successfully.');
