import { defineConfig } from 'vite'

/**
 * UMD build — one minified file for a plain <script> tag / CDN use.
 * Core only: exposes window.Emberwick. No React, no modules, no build step
 * required by the consumer.
 *
 * Run with: npm run build:umd  (after build:lib — emptyOutDir is off here)
 */
export default defineConfig({
  build: {
    outDir: 'dist-lib/umd',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2019',
    lib: {
      entry: 'src/chart/index.js',
      name: 'Emberwick',
      formats: ['umd'],
      fileName: () => 'emberwick.umd.js',
    },
  },
})
