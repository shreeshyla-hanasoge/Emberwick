# Changelog

All notable changes to Emberwick are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] — 2026-09-19

Metadata only. The code is identical to 0.4.1; nothing needs re-testing.

### Added

- `repository`, `homepage` and `bugs` in the published manifest, so the npm
  package page links back to the source, the demo and the issue tracker. These
  belong in `package.lib.json` — the root `package.json` is private and never
  reaches the registry — and 0.4.1 shipped without them. npm versions are
  immutable, hence a new patch rather than a corrected republish.

## [0.4.1] — 2026-09-19

Bug-fix release. Three feed-lifecycle races could put wrong prices on screen,
so this supersedes 0.4.0 for anyone attaching a `DataFeed`.

### Fixed

- **A slow `setFeed()` no longer overwrites a newer one.** `setFeed()` awaited
  `getBars()` without recording which call was current, so switching symbols
  faster than the network could resolve let the *earlier* request win: it
  replaced the new symbol's bars, overwrote `_unsub` — leaving the newer
  subscription permanently unreachable — and, because both feeds wrote to the
  bar slot keyed on the last bar's time, made the forming candle alternate
  between two instruments with no error raised. Every async feed read is now
  stamped with a generation that `setFeed()`, `detachFeed()` and `destroy()`
  invalidate.
- **Lazy history pages are bound to the feed that requested them.** A page in
  flight during a symbol switch could prepend one instrument's bars onto
  another's, and a stale empty page could latch `_exhausted` on the *new*
  symbol, permanently disabling paging for an instrument with history left.
  The page boundary is also re-read after the await, so a late page can no
  longer splice into the middle of the array and break the ascending-by-time
  invariant that marker resolution's binary search depends on.
- **Prepending history shifts the viewport exactly once.** `Smoothed.jump()`
  writes both `value` and `target`, so the follow-up `set(target + n)` added
  the page size a second time. The view eased past the newest bar, and because
  that pushed the visible range beyond the 80-bar trigger, lazy paging stopped
  firing for the rest of the session — one page load could permanently disable
  the feature.
- **`destroy()` is idempotent.** A second call threw from `Layers.destroy()`,
  which React 18 StrictMode's double-unmount could reach.

### Added

- **`'error'` event.** `subscribe('error', fn)` receives the thrown value from
  a failed `getBars()`, in both `setFeed()` and history paging. Previously
  `setFeed()` had no error path at all: a rejection escaped as an unhandled
  rejection and left a permanently blank chart that a consumer could not even
  detect. With no subscriber the error is logged rather than swallowed.
- **First test suite.** `npm test` runs `test/chart-feed-race.test.mjs` on
  plain Node — no jsdom, no browser. Eight of its nine cases fail against
  0.4.0. `npm run release` now runs it before building.

### Docs

- Documented the `'error'` event and feed-failure handling.
- Removed a duplicated header row in the events table.

## [0.4.0] — 2026-09-16

### Added

- Bar-by-bar `Replay` with transport, scrubbing, speed control and looping.
- Annotations: nine marker shapes, price lines and shaded zones, with
  collision-aware stacking and hover/click hit-testing.
- `'visibleRange'` state event and `chart.visibleRange()`.

## [0.1.0] — 2026-09-16

First public release: canvas candlestick core, `DataFeed` seam, `RandomFeed`,
React adapter, web component, UMD build.
