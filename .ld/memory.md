# Emberwick — project memory

## Overview
Embeddable, smooth-flowing candlestick chart library (a TradingView-chart
alternative). The frontend app here is the PLAYGROUND/showcase; the real
deliverable is the framework-free core in `src/chart/`, destined for npm.

Naming history: FlowChart → Tallow → **Emberwick**. `flowchart` collided with
flowchart diagrams; `tallow` was already taken on npm (an AI coding agent,
12 versions). Emberwick is an invented compound chosen for low collision risk.
`npm view emberwick` has NOT been verified yet.

Predecessor app "FlowChart" (`3801de5a-5c6d-4fd6-bc3e-358c918d5c39`,
flowchart.ldio.app) still exists, untouched — retire when ready.

## Stack
React 18 + Vite 5 playground. Chart core is plain JS, zero dependencies,
Canvas2D. No CSS framework — hand-written `src/styles.css` with CSS variables.

## Structure
- `src/chart/index.js` — public API (`createChart`, `Chart`, `DataFeed`,
  `RandomFeed`, themes, motion primitives, `version`)
- `src/chart/core/` — `Chart.js` (orchestrator), `Layers.js` (3 stacked
  canvases + DPR), `Loop.js` (single rAF, dirty-flag), `TimeScale.js`,
  `PriceScale.js`, `palette.js` (themes), `formatters.js` (ticks/time/volume)
- `src/chart/render/` — `grid.js`, `candles.js`, `crosshair.js`
- `src/chart/motion/` — `Tween.js` (`Smoothed` + `Tween`), `Inertia.js`,
  `LiveCandle.js`
- `src/chart/data/` — `DataFeed.js` (the pluggable seam), `RandomFeed.js`
- `README.md` — full integration guide (the how-to-plug-in doc)

NOTE: theme/format modules are named `palette.js` / `formatters.js`, NOT
`theme.js` / `format.js` (a platform write-guard blocked those paths during
the port from the old app). Content is identical to the originals.

## API wiring
None. No backend, no Lambda, no API Gateway. Data arrives through the
`DataFeed` interface; `RandomFeed` (seeded random walk) is the dev
implementation. Real providers = one new `DataFeed` subclass, zero core
changes.

## Conventions
- **The chart core must never import a framework.** Nothing in `src/chart/`
  may reference React. This is the precondition for the planned npm package,
  React wrapper and Web Component.
- Generic verbs in the public API (`createChart`, not `emberwickChart`).
- `Smoothed` (exponential, frame-rate independent) for anything continuously
  re-targeted; `Tween` only for discrete one-shots.
- Drag uses `jump()`, never easing — easing a drag reads as lag.
- `Loop.onFrame` returns `true` while animating; static chart = 0% CPU.

## Packaging (Phase 7)
- `vite.lib.config.js` — ESM, 3 entries: `index`, `react`, `webcomponent`.
  React is external everywhere (optional peer dep).
- `vite.umd.config.js` — minified UMD core only, global `Emberwick`.
- `package.lib.json` — the publishable manifest (root package.json stays
  private/app-only). `scripts/pack-lib.mjs` assembles `dist-lib/` (manifest +
  README + LICENSE + flattened `.d.ts`); publish with `npm publish dist-lib`.
- `scripts/check-size.mjs` — gzip budget, 60KB on the UMD core.
- Scripts: `build:lib`, `build:umd`, `pack:lib`, `size`, `release`.
- Adapters: `src/adapters/react/` (`<EmberwickChart />`, uses `createElement`
  NOT JSX so the lib build needs no JSX transform) and
  `src/adapters/webcomponent/` (`<emberwick-chart>`, shadow root).
- Types: hand-written `index.d.ts` beside each entry.

## Status
**PUBLISHED — `emberwick@0.1.0` is live on npm, MIT.** (Supersedes the
"not verified yet" note in Overview: the name was free and is now claimed.)
`npm run release` ran clean locally, 20 modules. Real gzip sizes: UMD core
**8.3KB** (24.34KB raw), ESM core **10.6KB** (39.50KB raw), react adapter
0.76KB, webcomponent 0.91KB — both size budgets pass.

Publish command needs the `./`: `npm publish ./dist-lib`. A bare `dist-lib`
makes npm treat it as a registry package spec and fail with E404.

Phases 0–2 and 7 complete, plus a marketing landing page.

## Annotations (v0.2.0, in source — NOT yet on npm)
- `src/chart/overlays/annotations.js` — normalise, binary-search time→index
  resolve, collision stacking. Markers carry a TIME, not an index, and
  re-resolve whenever the bar array shifts (keyed on length + bars[0].time).
- `src/chart/render/annotations.js` — 9 shapes, price lines, zones.
  Zones draw on the `base` layer (behind candles), lines + markers on `main`.
- Chart API: `setMarkers/getMarkers/addMarker/removeMarker/clearMarkers`,
  `setPriceLines`, `setZones`, `markerAt(x,y)`.
- Events `markerHover` (marker | null) and `markerClick` (marker only, and
  suppressed when the gesture panned — `moved` guard).
- Autoscale fits BARS only; annotations outside the bar range are off-screen.
  The landing demo derives its prices from the bars' own hi/lo for that reason.

## visibleRange event (v0.2.0, in source — NOT yet on npm)
Emitted from the END of `Chart._frame` (after drawing, so a handler may call
setData/setMarkers safely). Payload:
`{ from, to, fromTime, toTime, barCount, spacing, settled }`.
Also available on demand as `chart.visibleRange()`.
- It is a STATE event: `subscribe('visibleRange', fn)` calls fn immediately
  with the current window, so a consumer never waits for a pan.
- Dedup key = `from:to:fromTime:toTime:settled` (`Chart._rangeIdentity`).
  `spacing` is deliberately EXCLUDED — it is a float that moves every frame of
  an eased zoom, so keying on it would emit 60/sec. `settled` is INCLUDED so
  the last event of a gesture always arrives with settled:true (otherwise
  "defer work until the view stops" would never fire).
- `_rangeKey` is lazily created (undefined on the first frame → first emit).
- Times are in the key, so a prepended history page re-emits even though
  `from` stays 0.

## Replay scrubber (v0.4.0, in source — NOT yet on npm)
`src/chart/replay/Replay.js` — bar-by-bar playback over a fixed dataset.
- NO "replay mode" in the chart. The controller holds the dataset aside and
  hands the chart only the REVEALED PREFIX, so scales, crosshair, annotations
  and visibleRange behave as they do on live data ending at the cursor.
- Advancing exactly ONE bar goes through `chart.append()` (the feed-tick path,
  so the candle grows in); every other move uses `chart._swapBars()` +
  `ts.jumpToRealtime()`. `_swapBars` deliberately does NOT snap/re-prime like
  `setData` — a snap would fight the user's zoom on every scrub.
- Markers after the cursor are HIDDEN, not clamped (`markerFilter`, cached on
  the cursor): time→index resolution snaps to the nearest bar, so future
  markers would otherwise pile onto the newest revealed candle.
- Chart API: `startReplay(opts)` / `stopReplay()` / `replay` getter /
  `replayState()`; options `bars, from, speed, baseInterval, loop, follow`.
  Feed ticks and `_maybeLoadHistory` are ignored while replaying.
- `'replay'` state event (immediate call on subscribe, `active:false` after
  stop), dedup key = `active:playing:index:length:speed`.
- Cursor floor is index 1 — the scales infer timeframe from the first pair.
- Playground has a transport bar (`.replaybar`); landing page has a live
  `#replay` section with its own transport (`.lp-replaygrid`).

## TODOs
- **Publish 0.4.0 to npm** (`npm run release && npm publish ./dist-lib`) —
  annotations + visibleRange + replay all ship together as **0.4.0**. 0.2.0
  and 0.3.0 were never published, so the registry jumps 0.1.0 → 0.4.0 (gaps
  are fine). Headings above marked "(v0.2.0, in source)" are stale: those
  features are part of this same unpublished line.
- User asked for "0.0.4"; source was already 0.3.0 and npm has 0.1.0, so
  **0.4.0** was used instead (0.0.4 would be a downgrade npm rejects).
- Version lives in exactly TWO places: `src/chart/index.js` (`version`) and
  `package.lib.json`. The landing page renders `v{version}` in the hero pill
  and the annotations tag, so bumping the export updates both labels.
- Visually confirm rendering + 60fps on emberwick.ldio.app (never eyeballed)
- Landing page has BOTH v0.3.0 features as full sections in source:
  `#annotations` ("Mark up the chart") and `#range` ("Know what's on screen" —
  live 900-bar chart + viewport mini-map + live payload table, positioned
  entirely from the event), plus the hero pill, a "Range-aware" feature card
  and the range readout under the hero chart.
- dist/ is STALE: no build since the 0.3.0 version bump or the range section,
  so the built bundle (and the public URL) still show 0.2.0 content. Needs a
  build, then the editor's Publish button.
- dist/assets/ has ~10 stale hashed bundles from earlier builds; harmless,
  but worth pruning sometime
- OHLCV legend lives in the playground, NOT in the shipped package
- Markers are not draggable (hover/click only)
- Phase 4: indicators (SMA/EMA/VWAP/RSI/MACD) + multi-pane layout
- Phase 6: drawing tools (trendline, Fib, position tool) + undo/redo
- Session-gap collapsing (weekends currently render as ordinary bar steps)
