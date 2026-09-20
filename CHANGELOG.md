# Changelog

All notable changes to Emberwick are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.2] — 2026-09-20

Hardening for real consumer data. Two of these crash the chart outright on
input that several mainstream sources actually send.

### Fixed

- **Numeric-string prices no longer kill the frame.** `isFinite('100.5')` is
  true, so a string price passed every guard and reached `.toFixed()` in
  `render/candles.js` (the last-price tag) and `render/annotations.js` (the
  price-line axis label), throwing **inside the frame**. Ten consecutive
  throws and the loop stops, leaving a frozen canvas that needs
  `chart.resume()`. 0.5.1 taught `PriceScale` to coerce these when fitting the
  range, which made it worse: the scale fitted correctly and then the renderer
  died. Coercion now lives in one place, `formatters.toNumber()`, and both the
  scale and the renderers go through it. Laravel serialises decimal columns as
  strings; Binance, Bybit and Kraken return OHLC that way.
- **A close and open compared as strings** decided the last-price tag's
  colour lexicographically, so `'9'` read as greater than `'100'`.
- **An empty dataset no longer invents a price axis.** `setData([])` with a
  marker attached drew axis labels from 0.10 to 0.80 — for an instrument
  trading at 24,000. This is a normal frame, not an edge case: a backtest in
  progress returns its trades before its candles. The price grid and its
  labels now require a scale that has actually fitted a price, mirroring the
  time axis, which has always declined to draw without bars.

### Added

- **`lineVisible: false` on a price line** keeps the title pill and the axis
  tag but draws no rule — a labelled level without a line across the chart.
- **`PriceScale#primed`** — false until the scale has accepted a price.
- **`formatters.toNumber(v)`** — the single price-coercion path.
- **`chart.__v_skip = true`.** Vue's `ReactiveFlags.SKIP`: a plain string
  constant, inert everywhere else, and it stops Vue deep-proxying a Chart that
  lands in reactive state. Reading `chart.bars` from a component's `data()`
  would otherwise proxy every bar on an object repainting at 60fps.
- **An SSR import gate in CI.** The built package is imported under Node with
  no DOM, so a future module-scope `window` reference breaks Emberwick's CI
  rather than a consumer's production `vite build --ssr`.
- 10 tests and 8 mutants. 82 tests, 46/46 mutants caught.

### Docs

- Numeric-string prices, `lineVisible`, and Vue guidance: create the chart in
  `onMounted`, keep it out of `ref()`, and protect the bar array.

## [0.6.1] — 2026-09-19

Documentation only. No runtime change; the README ships inside the package,
so correcting it means publishing it.

### Docs

- **The entry-points table still advertised `emberwick/umd` as an import.**
  0.6.0 removed that subpath deliberately — a UMD file loaded as an ES module
  exports nothing — so the table was pointing at a specifier that now throws.
- **The marker-thinning threshold was stated in the wrong unit.** Thinning
  starts when a candle *body* is 3px or less, which is about 5.6px per bar,
  not 3px per bar: a body is 72% of its slot.
- **Double-click does more than snap to realtime.** It also resets the zoom to
  the default spacing and returns the price scale to autoscale.
- **`feed.destroy()` is the caller's to invoke.** The chart never calls it;
  `detachFeed()` and `chart.destroy()` only run the unsubscribe function that
  `subscribe()` returned.
- **`getMarkers().index` is `-1` until a frame has run**, because resolution
  happens in the render frame rather than in `setMarkers()`. `-1` also means
  *deliberately hidden* for a marker outside the loaded range, so it reads as
  "not drawn" rather than "not yet known". Marker id stability is documented
  alongside it.
- **The `markers`, `priceLines` and `zones` constructor options** have been
  implemented and typed since annotations landed, and documented nowhere.
- **`chart.visibleRange()`** was described in prose but missing from the
  methods table.
- **Zones had no field table** — `from`/`to`, `fromTime`/`toTime`, `color`,
  `border` and `label` are all read by the renderer.
- **Lazy history's page size is fixed at 1000**, which `initialBars` does not
  control, and a failed page now retries. Neither was written down.
- **`setData()` ends an active replay** and detaches the controller, so a held
  reference silently stops working. Same for a second `startReplay()`.
- **The source-layout block** omitted `replay/` and `overlays/` and named
  playground files that have since moved.
- **Known gaps** rewritten: the session-gap entry described collapsing as if
  it were the missing feature, when collapsing is the behaviour and *session
  marking* is what is absent. Added the lack of timezone control and the
  ESM-only constraint.

### Added

- Three tests pinning the newly documented surface: the constructor
  annotation options, the `getMarkers()` resolution timing, and what
  double-click actually resets. 72 tests.

## [0.6.0] — 2026-09-19

The surface matches the docs. Every change here is a place where the
advertised behaviour and the shipped behaviour disagreed. Minor rather than
patch: three of them change what an existing integrator sees.

### Changed

- **Wheel and pinch zoom are cursor-anchored on charts with no live feed.**
  The right-edge lock was keyed on `follow`, and `setData()` sets `follow` —
  so it applied to *every* fresh chart, including a static historical one,
  and silently defeated the cursor anchoring the README advertises. Measured
  drift on a fresh 900px chart was 26 bars. It self-healed after a single
  pixel of pan, which is why it read as intermittent rather than as a rule.
  The lock now requires an attached feed, so a live chart still holds the
  newest candle in place and a static one zooms where you point.
- **`upFill` / `downFill` now colour the candle bodies.** They were
  documented, typed as required and shipped in both built-in themes, and read
  by nothing. They fall back to `up` / `down` when unset, so a theme that
  colours via `up` is unaffected — and they are now optional in the type, and
  gone from the built-in themes. `up` / `down` continue to drive the
  last-price line and the price tag, which is what makes a separate body key
  worth having.
- **The React adapter compares `data` by content, not identity.** React hands
  a wrapper a new array identity on every render, and `setData()` re-anchors
  to the right edge — so the README's own `onCrosshair -> setState` example
  threw away the user's pan and zoom on every mouse sample. An unchanged array
  is now ignored, a moved last bar is merged as a tick, bars appended to the
  same history are appended, and only a genuinely different dataset
  re-anchors. The decision lives in `adapters/react/dataPlan.js`, which
  imports nothing and is framework-agnostic.

### Fixed

- **A devicePixelRatio change is detected.** `measure()` read the ratio but
  its only callers were the constructor and a ResizeObserver, which does not
  fire when a window moves to a different-DPI monitor at the same logical
  size — so the dpr branch of its own guard was unreachable and the canvases
  stayed blurry. A resolution media query now watches for it, re-arming each
  time, and is removed on `destroy()`. Guarded for environments with no
  `matchMedia`.
- **`import 'emberwick/umd'` no longer silently does nothing.** The UMD file
  is a `.js` under `"type": "module"`, so importing it exported zero bindings
  and quietly assigned `globalThis.Emberwick`. The `./umd` subpath is gone
  from the exports map, so that import now fails loudly. The file is
  unchanged and unmoved — `unpkg` and `jsdelivr` still serve it to `<script>`
  tags, which is all it was ever for.

### Added

- **`chart.resize()`** — re-measure now, for layout the element cannot
  observe (a container revealed from `display:none`, an ancestor transition).
- Test harness: a **recording canvas context**, plus `drawnValues()`,
  `clearOps()` and `setDevicePixelRatio()`. Canvas output was previously
  invisible to tests, which is why "does this theme key do anything?" had no
  answer for twenty of them.
- 10 more mutants (38 total), all caught.

### Docs

- Emberwick is **ESM-only**; `require()` reports that as `No "exports" main
  defined`. Documented, with the `await import()` and UMD alternatives.
- The zoom claim now states the live-feed exception; the React section
  describes the content comparison and notes that `options` is read once.

## [0.5.1] — 2026-09-19

Fixes regressions introduced by 0.5.0. **Upgrade from 0.5.0.** Three of these
are silent: no error, no console output, just wrong output on screen.

### Fixed

- **A feed supplying OHLC as numeric strings rendered a blank chart.** 0.5.0's
  `typeof v === 'number'` guard rejected them outright, so every candidate was
  skipped, `fit()` bailed each frame and the price bounds never left their 0–1
  defaults. Binance, Bybit and Kraken all return strings. Prices are now
  coerced and compared numerically; `null`, `undefined`, booleans and objects
  are still rejected, and log mode still rejects non-positives.
- **A persistently failing frame stopped the chart with no way back.** 0.5.0's
  give-up called `Loop.stop()`, which clears `_running` — and `_schedule()`
  early-returns while it is false, so not even `invalidate()` could revive it.
  The loop now reports the failure through the **`'error'` event** and
  `chart.resume()` restarts it. `Loop.start()` also clears the error budget,
  so a revived loop gets a full allowance. Errors below the cap still self-heal
  silently, as in 0.5.0.
- **`removeMarker(id)` stopped working for generated ids.** 0.5.0 made them
  monotonic to fix a collision, but `setMarkers()` re-normalises the whole
  array, so calling it twice with the same input minted fresh ids and any id
  the caller had captured was dead. Ids are now derived from the marker's own
  identity — time, shape, and nth duplicate — which is both unique and stable
  across calls, page loads and two charts showing the same data.
- **Replay re-inferred the timeframe from the revealed prefix.** `_swapBars`
  guessed from as few as two bars, and at the cursor floor a tape opening on a
  session break yielded 17.75 hours — the exact failure 0.5.0's median fix was
  written to prevent, on the one path that never reached it. `startReplay()`
  now computes the timeframe once from the whole dataset and the controller
  carries it through every swap. This also stopped a widened marker cut-off
  revealing future trades during playback.
- **`inferTimeframe` now samples a contiguous window from the middle** rather
  than striding, since a stride that is a multiple of the bars-per-session
  lands every sample on a session boundary. Below five samples it takes the
  minimum rather than the median: with two gaps the median IS the larger one.
- **A throwing state listener could stop the chart.** `visibleRange` and
  `replay` are emitted from inside the frame, so ten throws from a consumer's
  own handler exhausted the loop's error budget. Listener calls are now
  sandboxed. `subscribe()`'s immediate delivery is too — a throw there escaped
  before the unsubscriber was returned, leaving the listener unremovable.
- **A history page landing after replay started spliced into the prefix** and
  scrolled the viewport off the data. Bar-array ownership is now tracked
  separately from feed ownership, so a page that no longer belongs is dropped.
- **A rejected `setFeed()` left the previous symbol's bars on screen** under
  the new feed, and the next pan asked the new symbol for history anchored at
  the old symbol's oldest timestamp. Taking ownership now clears them.
- **`detachFeed()` did not reset the exhausted latch**, so a feed attached
  after one that ran out of history could never page.
- **The web-component entry threw a `ReferenceError` at import under SSR.**
  `extends HTMLElement` is evaluated when the module is, long before the
  `customElements` guard inside `register()` runs — which made this entry
  unimportable during a prerender pass, the exact path the README points
  Vue, Svelte and Angular users at.
- **`setMarkers()` kept a stale hover id** for a marker that no longer exists.

### Added

- **`chart.resume()`** — restart the render loop after it gives up. Returns
  false if the chart is destroyed or already running.
- **`frame()` and `settle()` in the test harness.** Before this, `Chart._frame`
  executed **zero times** across the whole suite, leaving marker resolution,
  autoscale and both state emissions unverified — which is how 0.5.0 shipped a
  blank-chart regression with every test green.
- `test/chart-0.5.1.test.mjs` — 19 cases. The suite is now 46 tests, and all
  13 fixes above were confirmed by mutation: reverting any one of them turns
  the suite red.

## [0.5.0] — 2026-09-19

Correctness release. Thirteen defects, most of them able to put wrong data on
screen without raising anything. Minor rather than patch because two fixes
change observable behaviour: markers outside the loaded range are now hidden,
and `priceScale.marginBottom` finally does what it has always documented.

### Fixed

- **An out-of-order tick no longer destroys the newest bar.** `append()` routed
  any bar at or before the last one into an in-place overwrite, so a late tick
  deleted the newest candle and left a duplicate timestamp — breaking the
  ascending-by-time invariant that marker resolution's binary search relies on.
  Equal timestamps still replace (that is an idempotent re-send of the forming
  candle); older ones are dropped.
- **Timeframe is inferred from the median gap, not the first pair.** Any
  exchange with a trading session puts a large gap at each day boundary; on NSE
  minute data `bars[1] - bars[0]` across an overnight break reads as 17.75
  hours. That number drove axis label density and Replay's future-marker
  cut-off, so a bad inference could leak a future trade into playback.
- **A null OHLC value no longer collapses the price scale.** `isFinite(null)`
  is `true`, so a null low passed the guard and dragged the minimum to zero,
  flattening every candle into the top of the plot.
- **Log mode no longer collapses on a non-positive price.** A single zero tick
  clamped to `1e-9` and turned the axis into a ~20-decade range.
- **A throwing frame no longer freezes the chart permanently.** `Loop` swapped
  the dirty set out before calling the frame, so one exception lost the pending
  layers and left nothing to reschedule. The set is now restored and retried;
  after ten consecutive failures the loop stops with a clear message rather
  than spinning at 60fps.
- **State-event dedupe is per listener.** `visibleRange` and `replay` shared a
  single key, so a late subscriber recorded the current state as "already
  sent" and every existing listener silently missed that update.
- **A transient history error no longer disables paging for good.** One failed
  page used to latch `_exhausted` permanently; it now retries and gives up
  only after three consecutive failures.
- **`Replay.seek()` ignores non-finite input.** `clamp()` compares with `<` and
  `>`, both false against NaN, so `seek(NaN)` passed through and
  `slice(0, NaN)` blanked the chart.
- **A replaced replay controller can no longer drive the chart.** Calling
  `startReplay()` twice left the first controller live in the caller's hands,
  still able to swap bars into a chart that had moved on. Controllers are now
  detached by `startReplay()`, `stopReplay()`, `setData()` and `destroy()`.
- **Markers outside the loaded range are hidden rather than clamped.**
  `nearestIndex()` clamps, so a trade from long before the window pinned itself
  to bar 0 and read as an event at the left edge. Tolerance is one timeframe.
- **`setData()` invalidates the marker index cache**, like every other bar-array
  mutator already did.
- **Generated marker ids no longer collide.** They were keyed off the array
  index, so a remove-then-add could hand the newcomer an id a survivor owned,
  and `removeMarker(id)` would take the wrong one.
- **`priceTicks()` cannot hang.** A non-finite bound made the step fall back to
  1 and the cursor start at `-Infinity`, where `v += step` never advances — an
  infinite loop inside a frame.
- **`priceScale.marginBottom` is read.** It was documented, typed and stored,
  but both bounds were padded from `marginTop`. With the default settings
  (0.12 / 0.12) nothing changes; only charts that set them differently move.

### Added

- `test/chart-correctness.test.mjs` — 18 cases; 17 fail against 0.4.2.
- `inferTimeframe(bars, fallback)` exported from `core/Chart.js` for testing.
- `Replay#detach()`.

## [0.4.2] — 2026-09-19

Metadata only. The code is identical to 0.4.1; nothing needs re-testing.

### Added

- `repository`, `homepage`, `bugs` and `author` in the published manifest, so
  the npm package page links back to the source, the demo and the issue
  tracker, and carries a publisher byline. These
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
