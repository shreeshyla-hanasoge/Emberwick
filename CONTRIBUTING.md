# Contributing to Emberwick

Thanks for looking. Emberwick is a canvas candlestick chart with **zero runtime
dependencies in the core** — that constraint shapes most of what follows.

## Ground rules, in one paragraph

The core (`src/chart/`) imports nothing but DOM and Canvas APIs. It must import
cleanly in Node with no DOM present, because consumers SSR-build it. The test
suite runs against a bare checkout with no `npm install`. If your change breaks
any of those three, it needs a conversation before it needs a pull request.

## Getting set up

Node 18 or newer (18, 20 and 22 are what CI runs).

```bash
git clone https://github.com/shreeshyla-hanasoge/Emberwick.git
cd Emberwick
npm install     # only needed for the demo app and the library build
npm run dev     # the demo site at localhost:5173
```

The tests need none of that:

```bash
npm test        # node --test test/*.test.mjs, against a bare checkout
```

## The checks

| Command | What it protects |
| --- | --- |
| `npm test` | Behaviour, via a DOM stub (`test/dom-stub.mjs`) — no browser, no install |
| `npm run mutate` | Reverts each shipped fix in turn; fails if the suite doesn't notice |
| `npm run build:lib` / `build:umd` | The ESM package and the core-only UMD global |
| `npm run verify:package` | The tarball actually contains what its manifest advertises |
| `npm run size` | The budget on the shipped bundle |
| `npm run release` | All of the above, in order |

Run `npm test` and `npm run mutate` before you push. The mutation check is the
one people forget, and it is the one that catches a test that asserts nothing.

## How to make a change

1. **Open an issue first** for anything that adds API surface, changes a
   default, or touches rendering behaviour. A bug fix with a failing test needs
   no preamble.
2. Branch off `master`.
3. Write the test first when you can. `test/chart-correctness.test.mjs` is the
   general home; behaviour tied to a release lives in `test/chart-<version>.test.mjs`.
4. Keep the diff to the thing you came for. Drive-by reformatting makes a
   review about whitespace.
5. Update `src/chart/index.d.ts` when you add or change public API — typings
   that lag the implementation are a bug we have shipped before.
6. Add a `CHANGELOG.md` entry under an `## [Unreleased]` heading, in the voice
   of the entries already there: what changed, and why it was worth changing.

### Code style

There is no linter, deliberately. Match the file you are editing: no
semicolons, single quotes, two-space indent, and comments that explain *why*
rather than restating the code. The existing comments are the style guide — see
`.github/workflows/ci.yml` for the tone.

### Performance is a feature

One `requestAnimationFrame` loop, dirty-flag driven, with visible-range culling.
Don't add a second loop, don't allocate per frame in a hot path, and don't
iterate the full bar array where the visible slice will do. A chart with 500k
bars loaded should still cost only the ~200 on screen.

## Pull requests

Fill in the template. A PR that says what broke, what you changed, and how you
proved it gets reviewed quickly; one that says "fixes stuff" does not.

CI must be green: tests on Node 18/20/22, the mutation run, the package build,
the size budget, and the SSR-safety import check.

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).

## Reporting bugs and asking for features

Use the [issue templates](https://github.com/shreeshyla-hanasoge/Emberwick/issues/new/choose).
A reproduction — the bars, the options, and the calls in order — is worth more
than a paragraph of description.

Security issues do **not** go in the tracker. See [SECURITY.md](SECURITY.md).
