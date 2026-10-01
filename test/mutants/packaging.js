/**
 * Mutants for the package boundaries (unit G). Aggregated by test/mutants.js;
 * `file` is repo-relative.
 *
 * Only the source rules can be mutated here. The build-level guards (no
 * chunks/, the byte-identical core, the UMD load-order banner) live in
 * scripts/verify-package.mjs and the CI workflow, which the mutation harness
 * does not run: it copies only src/ and test/.
 */
export const MUTANTS = [
  {
    // Importing only re-exports from the core entry is exactly what made
    // Rollup split the core into chunks/annotations-*.js when both entries
    // were built together. Nothing at runtime notices; the boundaries test
    // has to, by requiring the `version` binding.
    name: 'Drawings stop binding a value defined in the core entry',
    file: 'src/drawings/index.js',
    find: "import { version as coreVersion } from '../chart/index.js'",
    replace: "import { Smoothed as coreVersion } from '../chart/index.js'",
  },
  {
    // The same rule for the second opt-in entry: profiles built beside the
    // core must not split it either.
    name: 'Profiles stop binding a value defined in the core entry',
    file: 'src/profiles/index.js',
    find: "import { version as coreVersion } from '../chart/index.js'",
    replace: "import { isLight as coreVersion } from '../chart/index.js'",
  },
]
