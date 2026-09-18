import { defineConfig } from 'vite'

/**
 * Library build — ESM, multi-entry.
 *
 * Three public entries, so a consumer who only wants the core never pays for
 * the React adapter (and vice versa):
 *
 *   emberwick                 -> src/chart/index.js
 *   emberwick/react           -> src/adapters/react/index.js
 *   emberwick/webcomponent    -> src/adapters/webcomponent/index.js
 *
 * Run with: npm run build:lib
 */
export default defineConfig({
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    sourcemap: true,
    minify: false, // consumers minify; readable output helps debugging
    target: 'es2019',
    lib: {
      entry: {
        index: 'src/chart/index.js',
        react: 'src/adapters/react/index.js',
        webcomponent: 'src/adapters/webcomponent/index.js',
      },
      formats: ['es'],
    },
    rollupOptions: {
      // React is a peer dependency — never bundle it.
      external: ['react', 'react-dom'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
})
