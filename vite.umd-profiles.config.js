import { defineConfig } from 'vite'

/**
 * UMD build of the volume profiles — one minified file for a second <script>
 * tag, after emberwick.umd.js. Exposes window.EmberwickProfiles.
 *
 * The same shape as vite.umd-drawings.config.js, for the same reasons: the
 * core is EXTERNAL here, so this file reads window.Emberwick instead of
 * carrying its own copy. Folding profiles into emberwick.umd.js would make
 * every CDN user pay for a feature they never enable, and a second core in
 * here would give a page two Chart classes whose instances do not know each
 * other. So the CDN snippet is two tags, core first.
 *
 * Every path to the core ('../chart/index.js') is resolved to ONE bare
 * external id, 'emberwick', by the small plugin below: that id is what the
 * wrapper require()s under CommonJS and AMD, and what `globals` maps to
 * window.Emberwick. See the drawings config for why `output.paths` cannot do
 * this.
 *
 * Run with: npm run build:umd  (after build:lib — emptyOutDir is off here)
 */
const CORE = 'emberwick'
const isCore = (id) => /(^|\/)chart\/index\.js$/.test(id)

/**
 * Load-order guard, placed as a banner BEFORE the UMD wrapper.
 *
 * It checks for more than the global. Profiles need what 0.13 added to the
 * core (the `below` plugin layer, time-to-index on the plugin host), and a
 * page that pairs this file with an older emberwick.umd.js would otherwise
 * load without complaint and then paint profiles over the candles.
 * `timeToIndex` on the core global is the marker: 0.13 is the first release
 * that exports it. The banner stands aside under AMD and CommonJS, where the
 * loader, not script order, supplies the core.
 *
 * `verify-package` executes this file alone and asserts the message.
 */
const GUARD =
  ";(function (g) { if (typeof define === 'function' && define.amd) return; if (typeof module === 'object' && module.exports) return; if (!g.Emberwick || typeof g.Emberwick.timeToIndex !== 'function') throw new Error('EmberwickProfiles: load emberwick.umd.js (0.13 or newer) before emberwick-profiles.umd.js') })(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);"

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
      entry: 'src/profiles/index.js',
      name: 'EmberwickProfiles',
      formats: ['umd'],
      fileName: () => 'emberwick-profiles.umd.js',
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
