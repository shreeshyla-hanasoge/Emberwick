import { defineConfig } from 'vite'

/**
 * UMD build of the drawing tools — one minified file for a second <script>
 * tag, after emberwick.umd.js. Exposes window.EmberwickDrawings.
 *
 * The core is EXTERNAL here: this file reads window.Emberwick instead of
 * carrying its own copy. Folding drawings into emberwick.umd.js would make
 * every CDN user pay for tools they never enable, and bundling a second core
 * in here would give a page two Chart classes whose instances do not know each
 * other. So the CDN snippet is two tags, core first.
 *
 * Every path to the core ('../chart/index.js' from the entry,
 * '../../chart/index.js' from a subfolder) is resolved to ONE bare external
 * id, 'emberwick', by the small plugin below. That id is what the wrapper
 * require()s under CommonJS and AMD, and what `globals` maps to
 * window.Emberwick. The obvious config, `external: isCore` plus
 * `output.paths`, ships a broken CommonJS branch: Rollup resolves a relative
 * external to an absolute path and renders it relative to the output again,
 * so the wrapper required "./emberwick" (a file that does not exist); keeping
 * absolute externals absolute instead leaves the two specifiers as two ids and
 * the wrapper requires the core twice. verify-package (f) runs that branch.
 *
 * Run with: npm run build:umd  (after build:lib — emptyOutDir is off here)
 */
const CORE = 'emberwick'
const isCore = (id) => /(^|\/)chart\/index\.js$/.test(id)

/**
 * Load-order guard, placed as a banner BEFORE the UMD wrapper.
 *
 * It cannot live in our own code: the wrapper hands window.Emberwick to the
 * factory, and the factory's first statements define `class Eased extends
 * Smoothed`. With the tags in the wrong order that line throws "Class extends
 * value undefined", which names nothing a user could act on. The banner runs
 * first and says what to do instead. It stands aside under AMD and CommonJS,
 * where the loader, not script order, supplies the core.
 *
 * `verify-package` (f) executes this file alone and asserts the message.
 */
const GUARD =
  ";(function (g) { if (typeof define === 'function' && define.amd) return; if (typeof module === 'object' && module.exports) return; if (!g.Emberwick || typeof g.Emberwick.Smoothed !== 'function') throw new Error('EmberwickDrawings: load emberwick.umd.js before emberwick-drawings.umd.js') })(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);"

export default defineConfig({
  plugins: [
    {
      name: 'emberwick-core-external',
      // Before vite's resolver, which would turn the specifier into a file path.
      enforce: 'pre',
      resolveId: (source) => (isCore(source) ? { id: CORE, external: true } : null),
    },
  ],
  build: {
    outDir: 'dist-lib/umd',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2019',
    lib: {
      entry: 'src/drawings/index.js',
      name: 'EmberwickDrawings',
      formats: ['umd'],
      fileName: () => 'emberwick-drawings.umd.js',
    },
    rollupOptions: {
      external: (id) => id === CORE,
      output: {
        globals: { [CORE]: 'Emberwick' },
        banner: GUARD,
      },
    },
  },
})
