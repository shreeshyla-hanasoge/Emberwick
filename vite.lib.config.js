import { defineConfig } from 'vite'

/**
 * Library build — ESM, multi-entry.
 *
 * Five public entries, so a consumer who only wants the core never pays for
 * the React adapter, the drawing tools or the volume profiles (and vice
 * versa):
 *
 *   emberwick                 -> src/chart/index.js
 *   emberwick/react           -> src/adapters/react/index.js
 *   emberwick/webcomponent    -> src/adapters/webcomponent/index.js
 *   emberwick/drawings        -> src/drawings/index.js
 *   emberwick/profiles        -> src/profiles/index.js
 *
 * The two opt-in entries (drawings, profiles) import the core through
 * `./index.js` and nothing else. That only holds while each binds a value
 * DEFINED in src/chart/index.js (its `version`): an entry that imported
 * re-exports alone would make Rollup hoist the shared core modules into
 * chunks/, and the core would stop being one self-contained file.
 * `verify-package` fails the release if chunks/ appears.
 *
 * EMBERWICK_CORE_ONLY=1 builds without the opt-in entries. It exists for one
 * reason: CI builds the core both ways and `cmp`s the two index.js files,
 * which is the proof that building drawings and profiles beside the core
 * changed nothing a core-only user ships. Nothing else should set it.
 *
 * Run with: npm run build:lib
 */
const entry = {
  index: 'src/chart/index.js',
  react: 'src/adapters/react/index.js',
  webcomponent: 'src/adapters/webcomponent/index.js',
  drawings: 'src/drawings/index.js',
  profiles: 'src/profiles/index.js',
}
if (process.env.EMBERWICK_CORE_ONLY === '1') {
  delete entry.drawings
  delete entry.profiles
}

export default defineConfig({
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    sourcemap: true,
    minify: false, // consumers minify; readable output helps debugging
    target: 'es2019',
    lib: {
      entry,
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
