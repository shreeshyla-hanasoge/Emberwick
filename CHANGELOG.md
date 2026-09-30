# Changelog

All notable changes to Emberwick are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] — 2026-09-30

**Draw on the chart.** Trendlines, levels, Fibonacci, channels, ranges and
positions: pinned to time and price, snapped where you mean, undoable, and
absent from your bundle until you import them.

### Added

- **Drawing tools (#9)**, in a new entry, `emberwick/drawings`.

  ```js
  import { createChart } from 'emberwick'
  import { enableDrawings } from 'emberwick/drawings'

  const drawings = enableDrawings(createChart(el))
  drawings.setTool('fibRetracement')
  drawings.subscribe('change', () => save(drawings.getDrawings()))
  ```

  Decisions worth recording, each of which cost an alternative:

  - **The tool set, and why.** Nine stored types and fourteen presets:
    `trendLine` (with `ray`, `extendedLine` and `arrow`), `horizontalLine`
    (with `horizontalRay`), `verticalLine`, `rectangle`, `parallelChannel`,
    `fibRetracement`, `measure`, `position` (`long` and `short`) and `text`.
    Issue #9 asked for the trend line, the horizontal line and Fibonacci; the rest are cheap once the
    framework exists, and `measure` and `position` matter directly to an
    R-multiple backtest review. A variant is a preset over a shared type, so a
    reader can turn a ray back into a segment and a host stores one kind of
    row. Brush, callout, pitchfork, Gann, fib extension and time zones are
    deliberately deferred: each is a new geometry for a minority of users.
  - **Anchors are `{ time, price }`, and a future point is a bar count.** A
    point past the newest bar is stored as `{ time: lastBarTime, price, offset:
    k, tf }`, "k bars after"; one before the oldest bar is the mirror image.
    Pixel or index anchors would drift the moment history is paged in; a raw
    future timestamp would be wrong across every session gap. Offsets keep
    "five bars away" true across gaps and prepends, and `tf` rescales them when
    the timeframe changes. No new scale system: a time resolves to a
    fractional bar index and goes through the same `ts.x` and `ps.y` as the
    candles.
  - **Opt-in, with the measured sizes.** No drawing code is in the core, and CI
    proves the core entry is byte-identical with and without the drawings
    entry. The drawings are 70.7 KB gzipped as unminified ESM and 52.3 KB as
    the minified UMD (`emberwick-drawings.umd.js`, global `EmberwickDrawings`,
    loaded after the core), and only when imported. That is a large number
    next to a 20 KB core; `createDrawings(chart, { tools })` lets a bundler
    drop the tools you do not name, and takes no default set precisely so it
    can.
  - **Touch rules, and why tap-to-select.** On a phone a finger cannot hover
    and a selected box is mostly fill, so a press on an unselected drawing is
    left to the chart (pan, scrub or tap), a tap selects, and only then does a
    drag on a handle, border, label or move handle claim the press. A fill
    never claims a one-finger press: a swipe over a box pans. With a tool armed
    one finger draws and two pan. Without this, a chart with three boxes on it
    could not be scrolled with a thumb. Handles are a 44 pt target.
  - **Snapping, and magnet parity with the crosshair.** The first of Alt (free),
    Shift (0/45/90°), another drawing's anchor, a level (horizontal lines, fib
    levels, position prices, price lines, the channel's auto-fit), the OHLC
    magnet and the bar slot wins. The magnet is `'inherit'` by default:
    it follows `chart.options.magnet` with the crosshair's own reach (22 px), so
    one setting drives both and a snapped drawing lands where the crosshair
    said. The platform modifier (`Cmd` on macOS, `Ctrl` elsewhere, because
    Ctrl+click is a secondary click on a Mac) inverts it for one gesture. A
    snap, once engaged, releases only past 1.5 times its reach.
  - **The glue rule.** Anchors never move. A drawing is projected every frame
    through the same scales as the candles, and what glides is a *residual* in
    data space (bars and price) that decays to zero. Because it lives in data
    units it stays glued if the view zooms mid-glide, and it stops the loop as
    soon as it is under 0.1 px. Dragging is the exception and is crisp: a
    bar-slot change or a per-bar magnet change never glides, because a glide
    would trail the pointer by its time constant, and the house rule is that a
    drag jumps.
  - **`change` versus `drawing`.** `change` fires once per commit (the end of a
    gesture, an API call, an undo) with `created`, `updated` and `removed`, and
    is what a save-on-change host subscribes to. `drawing` is a stream at frame
    rate while a draft changes, with live stats, for readouts such as R:R while
    dragging. Conflating them would make either a per-frame save or a
    once-per-gesture readout. A third, state event, `box`, reports the selected
    drawing's painted box for floating toolbars, because none of pan, zoom or an
    autoscale ease changes `visibleRange`.
  - **Load versus edit.** `setDrawings` is a load: it clears history and
    selection, aborts a gesture and fires **no `change`**, and returns a
    `LoadReport` (`loaded`, `carried`, `rejected`, `renamed`, `truncated`,
    `orphaned`), also kept as `lastLoadReport`. If a load emitted `change`, a
    save-on-change host would write a half-loaded document back over the stored
    one. A string that does not parse throws and applies nothing.
  - **Per-id undo.** A history entry records only the ids it changed, as frozen
    before and after states, so undoing one drawing never clobbers an edit to
    another or an edit made with `{ history: false }`. `batch(fn)` is atomic:
    one entry and one `change`, or on a throw nothing at all.
  - **Inert preservation.** A row with an unknown `type`, or a `v` newer than
    this build, is carried verbatim and returned by `getDrawings()` in its z
    slot. Within a known `v`, unknown keys (top level, `style`, `options`) are
    carried too and survive an `update()`. `remove()` and `clear()` skip inert
    rows and do not count them. An older build must never destroy a newer
    build's data, least of all through a save-on-change host. Additive fields
    keep `v`; only a change an older build would misread bumps it.
  - **Replay against the source tape.** Anchors resolve against the replay's
    whole dataset, keyed on the `Replay` object, so seeking or stepping never
    moves or re-resolves a drawing, and marks past the cursor stay visible.
    Everything that reads price or volume (the magnet, a position's outcome,
    a measure's volume) sees revealed bars only, so a position flips to
    "Target hit" on the step that reveals it.

  Also: drawings take a `pane` (a horizontal line at RSI 70 is a drawing on the
  `'rsi'` pane); a position tool that reports a wrong-side stop instead of
  correcting it; a locked drawing that the chart pans through and a tap still
  selects; fills that yield to trade markers; and text that is a draft until its
  first non-empty commit, so a save-on-change host never has to delete a row it
  was just handed. The demo site's Playground exercises all of it.

- **`chart.addPlugin(plugin)` and `chart.removePlugin(plugin)`** (experimental).
  A small, generic seam: an opt-in layer gets its own `plugins` canvas between
  `main` and `overlay`, the first offer of every gesture, a per-frame `tick` and
  `draw`, and a `host` with live getters. Drawings are built on it and nothing
  else gets private access.

  The alternatives were each worse. Drawing on `overlay` loses to the
  crosshair, which clears it on every pointer move. Drawing on `main` would
  repaint every candle to drag a line. Monkey-patching the handlers cannot be
  made correct, because the gesture state (`dragging`, `touchMode`, `moved`,
  `pointers`) is local to `_bindEvents`, and `toImage` would miss the
  result. A canvas per plugin is about 7 MB at 900×500 and a pixel ratio of 2.

  It costs nothing without a plugin (three canvases, and a length check per
  input hook), and the core entry stays free of drawing code. The seam measures
  **+4.20 KB** gzipped in the core ESM (31.8 to 36.0 KB, unminified, with the
  comments) and **+2.62 KB** in the minified UMD (17.7 to 20.3 KB). The estimate
  was +2.6 KB for the ESM: the house-style comments in the gesture handling
  are what the difference is made of. See the README's *Plugins (experimental)*
  for the hooks, host fields, layer order and the keep-alive and error rules.

- **`toNumber` and `DASH` are exported** from the core, so a plugin coerces input
  and names a dash exactly as the core does. `'dashed'` now means one thing
  across price lines, series and drawings.

- **Two-finger pan.** Two fingers that move together now pan as well as zoom.
  This is the only way to reposition while a drawing tool is armed on touch,
  where one finger draws, and it shipped first, as its own change, for that
  reason: it alters behaviour for every touch user and had to be bisectable.

### Fixed

- **The first frame after idle took a dt of 64.** `Loop` left its last timestamp
  stale while idle, so the first frame after any pause clamped to 64 ms: 63% of
  a wheel-zoom ease and 27% of the candle-spawn tween in one step, and every
  hover fade popped instead of easing. It is now one nominal frame. **Existing
  motion changes slightly** as a result: eases that used to lurch on wake now
  start gently.
- **`setAnimate()` left `options.animate` stale**, so anything reading the
  option after a runtime toggle (a plugin, in particular) saw the old value.
- **A settling ease snapped its last step without redrawing the candles.**
  `Smoothed` set its value to the target on the frame it detected it had
  settled and reported no motion, so that frame was not a full repaint: the
  candles stayed at the previous value while everything painted afterwards, the
  crosshair included, projected through the snapped one. On a large dataset at
  maximum zoom the two disagreed by up to about 3.6 px (the epsilon is relative
  and the right edge is an absolute bar index). The snap frame is now drawn.
  **Each ease costs one more frame**, and a test on a 29,000-bar chart pins a
  plugin anchor to the candle's own x after a settle.
- **A third finger during a pinch froze it and started a pan**, and the finger
  left after a pinch drew a stray crosshair. A third finger is now ignored and
  the remaining one keeps panning.
- **A press whose `pointerup` was swallowed kept panning on hover.** A native
  context menu or a modal can eat the up. A mouse or pen move that reports no
  buttons held during a press, or a lost pointer capture, now ends that press.

### Changed

- **While a plugin is attached a fourth canvas exists**, and `overlay` moves from
  z-index 3 to 4. This matters only to a host stacking its own elements inside
  the chart container. A chart with no plugin is unchanged.
- **The crosshair honours exact points** (and `tags: false`), so a plugin that
  has already snapped a point gets the price it snapped to reported, not a `y`
  round trip. A point a plugin sets from its `tick` lands in the same frame's
  overlay, and the `'crosshair'` listeners run after the frame has drawn.
- **`Layers.composite(names, between)`** takes optional arguments, and
  **`toImage()` re-renders every layer synchronously from the current state
  before exporting** when a plugin is attached, so an export cannot lag the
  screen.
- **Core size budgets** are now 37 KB for the ESM and 21 KB for the UMD, against
  measured 36.0 and 20.3. The ESM budget was 36 while the seam was estimated
  at +2.6 KB; it measured +4.2 KB and was raised one kilobyte, not waved
  through. The drawings entry has its own budgets (85 KB ESM, 63 KB UMD), each
  1.2 times what was measured.

### Package

- **`emberwick/drawings`** (`drawings.js`, `drawings.d.ts`) and the drawings UMD
  (`umd/emberwick-drawings.umd.js`, global `EmberwickDrawings`, which reads
  `window.Emberwick` and says to load the core first if it is missing).
- **CI proves the core entry is byte-identical with and without drawings**:
  `index.js` and its source map from a core-only build against the full build.
- **`verify:package` fails on a `chunks/` directory**, which is how Rollup
  splits the core when the two entries share a deep import, and checks that the
  drawings UMD works under a CommonJS `require`.
- **`npm test` enforces the source-level rules** for `src/drawings`: imports
  only through `../chart/index.js`, no module-scope DOM access, and nothing
  newer than ES2019 that the build cannot lower.

### Documentation

- README: a *Drawing tools* section (enabling, the tool and preset table, mouse,
  phone and keyboard tables, snapping, saving and loading with the schema and
  the `LoadReport`, how anchors follow your data, undo, events, styling, motion,
  custom tools, framework recipes and the size, stated plainly) and a *Plugins
  (experimental)* section; the drawings entry point and CDN snippet; new
  Interaction rules; the Known gaps list.
- **The README's vendoring section was wrong and is corrected.** It said
  `src/chart/` imports nothing outside itself. `render/watermark.js` imports
  `src/brand.js`, so a folder copied on its own does not resolve. The section
  now says so and names the file; the import itself is unchanged in this
  release.
- The landing page's "15.8 KB gzipped UMD core" was stale by three releases; it
  is now the measured 20.3 KB. The Playground gained the drawing tools: a
  tool rail read off `TOOL_PRESETS`, a floating selection toolbar driven by the
  `box` event, a right-click menu, snap and undo controls, save and load, a
  load-report view, a 500-drawing button and an inspector and event log.

### Notes

- Drawings are experimental in 0.x: the plugin API and the `ToolDef` contract
  are the parts most likely to change before 1.0. The stored schema is not:
  it is versioned per drawing from the start, and unknown keys are carried.
- Known gaps, unchanged by this release and listed in the README: single
  selection, no edge auto-pan, no alerts, no templates, plain-text only,
  drawings are not keyed by symbol and do not influence autoscale.

## [0.11.0] — 2026-09-25

**The crosshair works on a phone.** Tap a bar to read it, long-press to scrub
along it, and it stays put when your finger lifts.

### Fixed

- **The crosshair is usable on a phone.** Tap a bar to place it, long-press and
  drag to scrub along it, and it stays put when your finger lifts.

  The input layer treated a finger exactly like a mouse, and the mouse model
  does not survive the translation. `cursor` was only ever assigned in
  `_onMove`, so a tap that never moved drew nothing at all. `_onDown` set
  `dragging = true` unconditionally, so the one movement a finger *can* make
  drove the crosshair and `panBy` at the same time — the crosshair tracked
  correctly, but across bars that were sliding out from under it, which reads
  as a crosshair welded to your fingertip. And `pointerleave` fires right after
  `pointerup` on touch, because the pointer stops existing when the finger
  lifts, so the crosshair was destroyed at the exact moment it became worth
  reading.

  A mouse can hover, and hovering costs nothing, so tracking and panning can
  share one gesture. A finger cannot hover: touching *is* the gesture. So the
  two are separated in time instead — tap places, long-press scrubs, an
  immediate drag pans:

  ```js
  createChart(el, {
    touchCrosshair: true,      // default
    touchCrosshairDelay: 350,  // ms a finger rests before a drag scrubs
  })
  ```

  Movement under 10px is a tap, not a pan, because a resting finger drifts.
  The distance travelled before a pan commits is discarded rather than
  applied, or the chart would jump by the slop the instant it decided. A
  scrub never feeds the inertia sampler, so letting go of one does not fling
  the view. A second finger, a pan, a cancelled gesture, or the new
  `chart.hideCrosshair()` all dismiss a sticky crosshair.

  Mouse and pen behaviour is unchanged — pen hovers, so it stays on the mouse
  path. `touchCrosshair: false` restores the old one-finger behaviour.

### Added

- **`chart.hideCrosshair()`** — dismiss a crosshair a tap or long-press left
  standing, emitting a null `'crosshair'` event so a readout empties with it.
  A no-op on mouse.

## [0.10.0] — 2026-09-21

**The view is yours to set.** A window you choose, a drag that lands where you
point, and a README that admits what already shipped.

### Added

- **`chart.setVisibleRange({ from, to })`** — open on a WINDOW of the data
  rather than all of it.

  ```js
  chart.setData(bars)                            // all 29,105 of them
  chart.setVisibleRange({ from: 0, to: 99 })     // open on the first hundred
  ```

  `fitContent()` for a run you mean to read forward. Fitting a finished
  backtest whole is the honest view of the dataset and a useless first
  impression: 29,000 bars across an 832px plot is 0.03px each, every series
  collapses onto every other, and the trade markers thin to one per four
  pixels. The rest of the run stays loaded and pannable — a view, not a filter.

  The arithmetic already existed, in `TimeScale.fitContent`; what did not was a
  way to reach it. It was absent from the typings, and TimeScale holds no
  reference to the loop, so calling it repainted nothing — the two-line
  workaround in the wild was `chart.fitContent()` followed by
  `chart.ts.fitContent(100)`, which worked only by re-targeting a frame that
  another call had already scheduled.

  Decisions worth recording:

  - **`follow` is derived, not set**: `to >= barCount - 1`. It is not a
    preference but a claim of fact — the right edge IS the newest bar — which
    `panBy` clears and `setBarCount` reads. A window short of the newest bar
    that went on following is re-targeted by the very next `append()`:
    measured on 29,000 bars, one new candle moved a window pinned at 0..99 to
    6306..6409 on the first frame. `fitContent`'s unconditional `true` was this
    same expression evaluated on the only input Chart ever gives it.
  - **Ends clamp, they do not refuse.** An index is written against a length
    the caller often did not know, and a history page prepended in front of it
    renumbers every bar. `false` is kept for what no clamp can rescue: a
    destroyed chart, fewer than two bars, ends that are not numbers, and a
    container the browser has not laid out yet — so a call that raced the data
    load stays loud.
  - **Reading the window back is not the identity of setting it.**
    `visibleRange()` reports every bar with any pixel on screen, so it answers
    a bar or two wider. Save what you *set*. There is a test pinning this, so
    nobody "fixes" either half to match the other.
  - **Indices only in v1.** A `{ fromTime, toTime }` variant is a field away,
    and arrives as one rather than as a second method.

- **`TimeScale.setVisibleRange(from, to)`** and **`TimeScale.fitContent(n)`**
  are now declared. The second was already shipping, just untyped — which is
  half of what made the windowed fit unreachable.

- **`PriceScale.panBy(dy)`.** Translates the visible range by a pixel delta,
  positive `dy` carrying the content down with the pointer. It is the
  complement of `scaleBy`, which holds the midpoint and changes the span;
  until now the price axis could be stretched but never moved, so seeing what
  sat just above the high meant widening the range and shrinking every candle
  to get there.

  Bounds translate in *transformed* space, so a pixel is a fixed price step in
  linear mode and a fixed ratio in log mode. It jumps rather than easing and
  measures against the rendered value rather than the target, because a drag
  has to track the finger exactly.

  Like `scaleBy`, it clears autoscale; `resetAuto()` restores it.

- **`scaleBy` is now declared** in `index.d.ts`. It was already shipping, just
  untyped.

- **`PriceScale.panBy(dy)`.** Translates the visible range by a pixel delta,
  positive `dy` carrying the content down with the pointer. It is the
  complement of `scaleBy`, which holds the midpoint and changes the span;
  until now the price axis could be stretched but never moved, so seeing what
  sat just above the high meant widening the range and shrinking every candle
  to get there.

  Bounds translate in *transformed* space, so a pixel is a fixed price step in
  linear mode and a fixed ratio in log mode. It jumps rather than easing and
  measures against the rendered value rather than the target, because a drag
  has to track the finger exactly.

  Like `scaleBy`, it clears autoscale; `resetAuto()` restores it.

- **`scaleBy` is now declared** in `index.d.ts`. It was already shipping, just
  untyped.

### Changed

- **A drag is classified against the whole plot, not against the price pane.**
  `_onDown` tested the pointer against `plot.h`, which stopped meaning "the
  bottom of the plot" the moment a second pane existed — so every pointer
  below the price pane read as being on the time axis, and a horizontal drag
  inside an oscillator ZOOMED the chart instead of panning it. On a 3:1 layout
  that is 30% of the plot; on 3:1:1, 48%. The same trap that drew the time axis
  between the panes in 0.9.0.

  A price-axis drag now stretches the pane beside the pointer, too. Dragging
  the gutter next to an oscillator used to stretch the price scale — the pane
  the reader was not pointing at.

  The classification is extracted as `_classifyDrag(x, y)`, which names the
  decision so a test and a mutant can address it rather than inferring it from
  a downstream effect. The target pane is latched for the gesture, not
  re-resolved per move, or one continuous finger movement would silently
  retarget halfway across a boundary.

- **Every pane returns to autoscale on a view change.** `fitContent()`,
  `setVisibleRange()`, `snapToRealtime()` and the double-click reset all went
  through `chart.ps`, a getter onto pane 0. Harmless while nothing could put a
  sub-pane scale into manual — and the drag fix above is exactly what could.
  Double-click is the documented way out of a hand-set scale, and it was
  releasing a pane the reader had never touched.

- **A programmatic view change cancels an in-flight pan glide.** `fitContent`
  and `setVisibleRange` jump the scale but scheduled nothing to stop the
  inertia, so a flick still gliding kept feeding `panBy` into the frame and
  dragged the window away over the next second — measured at 55 bars, with the
  call already returned `true` and documented as not animated. A pointerdown
  on the chart already stopped inertia; a toolbar button outside it did not.

- **A plot drag pans vertically as well as horizontally.** `dy` used to be
  computed and discarded. It now drives the price scale of the pane under the
  pointer — only that pane's, since panes hold unrelated quantities and
  dragging a price chart has no business shifting an RSI off its 0–100.

  Inertia stays horizontal. It models a flick along the time axis, where there
  is more data to glide into; a vertical throw would coast the range off the
  candles into blank space with nothing to stop it.

- **Double-click resets the axis it lands on.** The price gutter returns that
  pane to autoscale, the time axis resets the time scale, and the plot still
  resets both as it always has. The region is resolved by the same
  `_classifyDrag` the drag itself uses, so the area that scales an axis is by
  construction the area that resets it.

  A double-click carrying no coordinates still resets everything.

### Fixed

- **A gesture the browser takes away no longer leaves the chart nudged.**
  Under `touch-action: pan-y` — what an embedded chart in a scrolling page
  sets so the reader can still scroll past it — the user agent delivers the
  first few pointermoves and only then decides the drag is a page scroll and
  fires `pointercancel`. Those moves used to stick, and because any pan clears
  autoscale they stuck *permanently*: scrolling past a chart would walk its
  price axis off the candles. The vertical part of a cancelled gesture is now
  unwound exactly.

- **Replacing the bars while the price scale is manual no longer blanks the
  chart.** `setData` unprimes the scale but left `auto` alone, and `endFit()`
  bails while `auto` is false — so a manual window from the previous dataset
  survived onto bars it could not see, with the axis not even drawn to explain
  why. New bars that fall entirely outside the manual window now restore
  autoscale, the way `setData` already re-anchors time. Bars that still
  overlap keep the reader's window, so toggling a series on the same data
  leaves their pan alone.

  The kept window is no longer unprimed either. `_primed` is cleared only for
  a scale that is actually going to re-fit; unpriming one whose range we have
  deliberately KEPT left a real window with an axis that was never drawn —
  the same blank axis, reached by the other branch.

- **A scale dragged before it was ever fitted can still fit.** `endFit()`
  returned early on `auto === false`, which is right for a manual range that
  EXISTS and wrong for one that does not: a scale taken out of autoscale
  before its first fit could never acquire one, and `drawPriceAxis` declines
  to draw an unprimed axis, so the pane went blank for good. Reachable as soon
  as a gutter drag started addressing the pane beside the pointer — an
  oscillator whose series are hidden, or not loaded yet, was one drag from
  permanent.

- **The crosshair time tag is drawn below the last pane.** `drawCrosshair` is
  handed the hovered PANE's rect, so `plot.h` is that pane's height: hovering
  an oscillator put the timestamp a third of the way up the chart, in the
  middle of the candles. Measured at y=149 on a pane spanning 337..474. This
  is the same defect the 0.9.0 notes record for the time axis — `grid.js` was
  fixed in that sweep and this renderer was missed, so it now reads the same
  `plotBottom`, with the same `isFinite` guard.

- **A reversed *fractional* window no longer narrows.** `setVisibleRange`
  rounded before it swapped, so `{ from: 99.5, to: 0.4 }` floored the high end
  and ceiled the low one and arrived a bar narrower at each end — the exact
  opposite of the widening the rounding exists to guarantee.

### Documentation

- **"Known gaps" no longer denies two features 0.8.0 shipped.** The section
  listed timezone control and session-boundary labelling as missing while the
  same README documented both — an entire "Time zones" section, a methods-table
  row, and the day-boundary rule. The timezone entry was the actively harmful
  one: it told a reader that exchange-local wall-clock timestamps "will render
  shifted", which is precisely the case `timeZone: 'UTC'` now handles.

  The rest of the section was audited against the source in the same pass,
  since it predated 0.7.0. The `RandomFeed` seam is described by its actual
  cause; the ESM-only entry no longer denies the UMD bundle the same README
  tells people to load from a CDN, and names the real constraint (no `require`
  export condition); the hand-written-types entry adds that nothing in CI
  checks them. Two gaps that panes introduced and nobody had listed are now
  listed: annotations are price-pane only, and a pane cannot be reweighted or
  moved short of removing it.

### Notes

- `chart.ts.fitContent(n)` with an `n` that is not the bar count now derives
  `follow: false` where it latched `true`. That call is the workaround this
  release replaces; `Chart.fitContent()` always passes the whole bar count and
  is bit-identical.
- `minSpacing` is still lowered by a fit and never raised back, so a wide
  window leaves the interactive floor where it put it. Pre-existing, inherited
  rather than reconsidered.
- The DOM stub gained `setPointerCapture`, without which no pointer handler
  was reachable from a test at all — every gesture test here is new ground.
- Free panning is not yet written up in the README beyond the Interaction
  table.
- 45 tests and 21 mutants. 183 tests, 107/107 mutants caught.

## [0.9.0] — 2026-09-20

**Panes.** An oscillator can have a scale of its own.

### Added

- **`chart.addPane(id, options)`** and the pane API. A pane is a horizontal
  band with its own price scale, sharing the time axis with every other pane.

  ```js
  chart.addPane('rsi', { weight: 1 })
  chart.setSeries('rsi14', { data: points, pane: 'rsi' })
  ```

  `addPane`, `removePane`, `panes()`, `pane(id)`, `paneScale(id)`,
  `paneRect(id)`; options `weight`, `minHeight`, `priceScale`, `title`; and a
  `paneGap` chart option. `'price'` is the pane candles, volume, markers,
  price lines and zones draw on — it is always the top band and cannot be
  removed.

  This is what an oscillator needs. RSI lives on 0–100; on an instrument
  trading near 24,000 a shared scale flattens the candles into a line.

- **`pane` on a series.** Defaults to `'price'`. **An unknown pane id throws**
  rather than falling back: defaulting would put an RSI at 50 through a 24,000
  autoscale and flatten the candles, which is precisely the failure panes
  exist to prevent, arriving with no error at all.

- `drawPriceAxis` is extracted from `drawGrid`, so a sub-pane draws its own
  horizontal grid and labels. Sub-panes never clear a canvas — exactly one
  renderer clears each layer — which is what makes multi-pane drawing an
  append to the existing draw block rather than a restructure of it.

### Changed

- **`chart.ps` and `chart.plot` are now getters onto the price pane.** Both
  still work. `paneScale('price')` and `paneRect('price')` supersede them and
  say which pane they mean. One improvement falls out: `chart.plot` is a live
  rect mutated in place rather than replaced on every layout, so a reference
  held across a resize stays correct.
- A sub-pane is scaled by its own series alone — it never sees the bars.
- The crosshair belongs to the pane under the pointer, so its price tag reads
  that pane's scale.

### Fixed

- **The time axis is anchored below the last pane.** It was drawn at
  `plot.h`, which stopped meaning "the bottom of the plot" the moment a second
  pane existed — the labels and the separator appeared *between* the panes.
  Caught by looking at the rendered page, not by a test.
- A duplicate `export type LineStyle` in the typings, introduced by the 0.7.0
  series work. Duplicate identifier is a hard TypeScript error, so anyone
  type-checking against 0.7.0 or 0.8.0 failed to compile; the runtime was
  unaffected.

### Notes

- Panes are not resizable or reorderable. Heights come from `weight`.
- Landing page: a Panes section that makes the argument by letting you break
  it — one click moves the RSI onto the price scale.
- 18 tests and 12 mutants. 138 tests, 86/86 mutants caught.

## [0.8.0] — 2026-09-20

What a finished dataset needs that a live chart does not: the whole run in
view, and labels in the zone the session is defined in.

### Added

- **`chart.fitContent()`** — zoom and scroll so the whole dataset is on
  screen. The opening move for a backtest or a replay tape, where the useful
  first view is the entire run rather than the last hundred bars at the
  default zoom. Returns false when there are fewer than two bars.

  Deliberately **not animated**: easing 4,000 bars from 9px each down to 0.2
  reads as a glitch, not as polish — the same reason a drag uses `jump()`.

  Fitting is allowed to zoom out past `timeScale.minSpacing`, and lowers it to
  match. That bound exists to stop a wheel gesture burying the chart in mush;
  an explicit "show me everything" is a different intent, and clamping it
  would both hide part of the dataset and leave the next zoom-in jumping
  discontinuously back up to the old floor.

- **`timeZone` option and `chart.setTimeZone(zone)`** — format every rendered
  timestamp in an IANA zone rather than the browser's. An NSE chart opens at
  09:15 whoever is reading it.

  Display only: bar times, the crosshair payload, `visibleRange()` and marker
  times all stay in the ms epochs you supplied. `Intl.DateTimeFormat`
  instances are memoised per zone, because these run once per axis label per
  frame.

- **Day-boundary labels.** The first label of each new day shows the date
  instead of the time, in the configured zone. The old rule printed a date
  only at local midnight — a moment intraday instruments never trade — so a
  multi-day intraday chart rendered a wall of times with no indication of
  where one session ended.

### Changed

- The time formatters are now built per chart (`createTimeFormatter`) and
  passed through the frame state, rather than imported directly by
  `render/grid.js` and `render/crosshair.js`.

### Notes

- The zone formatter asks for `hourCycle: 'h23'` rather than
  `hour12: false`, which has historically resolved to `h24` in some engines
  and rendered midnight as `24:00`.
- Landing page: two new feature cards, and the roadmap updated.
- 14 tests and 12 mutants. 114 tests, 70/70 mutants caught.

## [0.7.0] — 2026-09-20

**Line series.** Emberwick can draw something other than candles.

### Added

- **`chart.setSeries(id, options)`** and friends — an arbitrary y-value over
  the bar time axis: a moving average, a VWAP, an equity curve, a band.

  ```js
  chart.setSeries('ema20', { data: points, color: '#c084fc' })
  chart.setSeriesData('ema20', nextPoints)
  chart.setSeriesVisible('ema20', false)
  chart.removeSeries('ema20')
  chart.clearSeries()
  chart.getSeries()
  ```

  Series are **keyed**, so a host toggling one indicator on a panel of twelve
  does not rebuild the other eleven. Insertion order is draw order; they paint
  over the candles and under price lines and markers.

  Options: `data`, `color`, `lineWidth`, `lineStyle`, `stepped`, `visible`,
  `title`.

- **A point with no value lifts the pen.** `value` absent, `null` or
  non-numeric ends the current line, and the next valued point starts a fresh
  one. It is never drawn as zero and never interpolated across. An indicator
  in its warm-up period has no value; that is not the same as a value of zero,
  and a line that quietly joins across a gap lies about the data.

- **Series drive autoscale.** A visible series widens the price range along
  with the bars, so a value outside the candle range is in view rather than
  clipped at the plot edge. Hidden series are excluded.

- **`PriceScale` fitting is now a transaction** — `beginFit()`, `consider()`,
  `considerBars()`, `endFit()` — so more than one kind of thing can influence
  the range. `fit()` is unchanged as a thin wrapper.

- Landing page: a **Series** section with two live EMAs, a legend wired to
  `setSeriesVisible`, and the warm-up gap visible in the data.

### Fixed

- **A null `time` no longer places a marker at the epoch.** `isFinite(null)`
  is true and `+null` is 0, so `{ time: null }` silently became a marker at
  1970. Marker and series times both coerce through `toNumber` now.

### Notes

- Series share the price axis with the candles. An equity curve at 200,000
  against a price near 100 will render, but the candles become a flat line —
  a second pane with its own scale is the answer, and it does not exist yet.
- No indicator maths. Emberwick draws the line you hand it.

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

## [0.3.0] — 2026-09-18

Backfilled. This release predates the changelog, which began at 0.4.1;
reconstructed from the published tarball rather than from memory.

### Added

- **The `'visibleRange'` event** and `chart.visibleRange()`. A *state* event: a
  new subscriber is called immediately with the current window, then only when
  that window actually changes. `spacing` is reported but deliberately excluded
  from the change test — it is a float that moves every frame of an eased
  zoom, so keying on it would make this a 60/sec firehose. `settled` IS part of
  the test, so the last event of a gesture always arrives with `settled: true`.

## [0.2.0] — 2026-09-18

Backfilled, as above.

### Added

- **Annotations**: `setMarkers`, `getMarkers`, `addMarker`, `removeMarker`,
  `clearMarkers`, `setPriceLines`, `setZones` and `markerAt(x, y)`. Nine marker
  shapes, horizontal price lines and shaded zones, with collision-aware
  stacking and hit-testing behind the `'markerHover'` and `'markerClick'`
  events. Markers carry a timestamp rather than an index, so they re-resolve
  when the bar array shifts.

## [0.1.0] — 2026-09-16

First public release: canvas candlestick core, `DataFeed` seam, `RandomFeed`,
React adapter, web component, UMD build.
