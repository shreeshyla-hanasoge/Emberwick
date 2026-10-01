# Emberwick

A smooth-flowing candlestick chart for the web. Canvas-rendered, framework-free,
and driven by a pluggable data feed — drop it into any financial frontend and
point it at your own market data.

- **Zero dependencies.** The core imports nothing but DOM and Canvas APIs.
- **Framework-agnostic.** Works in React, Vue, Svelte, or a plain `<script type="module">`.
- **Actually smooth.** Ticks ease into the forming candle, the price axis glides
  to new bounds, zoom is cursor-anchored and eased, panning has inertia.
  (While a live feed is attached and the chart is following realtime, zoom
  holds the right edge instead, so the newest candle stays put.)
- **Fast on big data.** One `requestAnimationFrame` loop, dirty-flag driven,
  with visible-range culling — 500k bars loaded costs only the ~200 on screen.
- **Annotated.** Nine marker shapes, price lines and shaded zones, with
  collision-aware stacking and hit-testing for hover and click.
- **Drawn on.** Trendlines, Fibonacci, channels, ranges and positions, pinned
  to time and price, snapped where you mean and undoable — in a separate entry
  that is absent from your bundle until you import it. See
  [Drawing tools](#drawing-tools).
- **Profiled.** Session and visible-range volume profiles with the point of
  control and value area, drawn under the candles from data you supply, in a
  third entry that is also absent until you import it. See
  [Volume profiles](#volume-profiles).

---

## Installing

### From npm

```bash
npm install emberwick
```

```js
import { createChart, RandomFeed } from 'emberwick'
```

### From a CDN, no build step

```html
<div id="chart" style="height: 480px"></div>
<script src="https://unpkg.com/emberwick/umd/emberwick.umd.js"></script>
<script>
  const chart = Emberwick.createChart(document.getElementById('chart'))
  chart.setFeed(new Emberwick.RandomFeed({ timeframe: 60000, speed: 60 }))
</script>
```

Drawing tools are a second file, loaded **after** the first:

```html
<script src="https://unpkg.com/emberwick/umd/emberwick.umd.js"></script>
<script src="https://unpkg.com/emberwick/umd/emberwick-drawings.umd.js"></script>
<script>
  const chart = Emberwick.createChart(document.getElementById('chart'))
  const drawings = EmberwickDrawings.enableDrawings(chart)
</script>
```

Volume profiles are a file of their own too, loaded the same way:

```html
<script src="https://unpkg.com/emberwick/umd/emberwick.umd.js"></script>
<script src="https://unpkg.com/emberwick/umd/emberwick-profiles.umd.js"></script>
<script>
  const chart = Emberwick.createChart(document.getElementById('chart'))
  const profile = EmberwickProfiles.createVolumeProfile(chart, { data })
</script>
```

The UMD core build exposes the global `Emberwick`, the drawings build
`EmberwickDrawings` and the profiles build `EmberwickProfiles`. Each opt-in
file reads `window.Emberwick` rather than carrying a second copy of the core,
so loading one first throws a message that says to load `emberwick.umd.js`
before it (the profiles file also refuses a core older than 0.13, which has no
layer under the candles for it to draw on); folding them into the core file
would make every CDN user pay for features they never enable.

All three UMD builds are for `<script>` tags and CDNs only — there is deliberately
no `emberwick/umd` import specifier, because a UMD file loaded as an ES module exports nothing
and quietly assigns a global instead.

> **Emberwick is ESM-only.** `import` works everywhere; `require('emberwick')`
> does not, and Node reports that as `No "exports" main defined`. Use a dynamic
> `await import('emberwick')` from CommonJS, or the UMD build above.

### By vendoring the source

Nothing stops you copying the core in directly:

```bash
cp -r src/chart /path/to/your-project/src/chart
cp -r src/drawings /path/to/your-project/src/drawings   # only if you want drawing tools
cp -r src/profiles /path/to/your-project/src/profiles   # only if you want volume profiles
```

```js
import { createChart, RandomFeed } from './chart/index.js'
import { enableDrawings } from './drawings/index.js'
import { createVolumeProfile } from './profiles/index.js'
```

Copy them as siblings: `src/drawings/` and `src/profiles/` each reach the core
only through `../chart/index.js`, and neither imports the other. Vendor them
from one release; a mismatch logs one warning at `createDrawings` or
`createVolumeProfile`. The core folder has no framework dependency and never
imports either. It has one import that points outside it, though:
`render/watermark.js` reads the logo paths from `src/brand.js`, so copy that
file to `src/brand.js` beside the folder (or point the import at your own).
Earlier versions of this section claimed the folder was fully self-contained;
it was not. Anything that can bundle ES modules
(Vite, webpack, Rollup, esbuild, or a browser with native ESM) can consume it
as-is.

### Entry points

| Import | Contents |
|---|---|
| `emberwick` | The core: `createChart`, `Chart`, feeds, themes, motion primitives |
| `emberwick/react` | `<EmberwickChart />` React component |
| `emberwick/webcomponent` | Registers `<emberwick-chart>` (side-effecting import) |
| `emberwick/drawings` | Drawing tools: `enableDrawings`, `createDrawings`, the nine tools, `normalizeDrawings`. 52.4 KB gzipped as the minified UMD, 71.3 KB as unminified ESM, and only when you import it |
| `emberwick/profiles` | Volume profiles: `createVolumeProfile`, `computeValueArea`. 6.2 KB gzipped as the minified UMD, 9.7 KB as unminified ESM, and only when you import it |

TypeScript declarations ship for all five entries. The UMD build is not an
import specifier — it is a file you point a `<script>` tag or a CDN at.

---

## Quick start

```js
import { createChart, RandomFeed } from 'emberwick'

const chart = createChart(document.getElementById('chart'))
await chart.setFeed(new RandomFeed({ timeframe: 60_000 }))
```

The container needs a real size — the chart fills it and follows resizes:

```html
<div id="chart" style="width: 100%; height: 480px"></div>
```

> The container's `position` is set to `relative` automatically if it is
> `static`, because the canvas layers are absolutely positioned inside it.

Without a feed, push bars in directly:

```js
const chart = createChart(el)
chart.setData(bars)          // Bar[], ascending by time
chart.update(formingBar)     // merge a tick into the last candle (animates)
chart.append(newBar)         // open a new candle
```

---

## The bar shape

One contract, used everywhere:

```js
{
  time: 1737024000000,  // ms epoch, start of the bar
  open: 100.2,
  high: 101.4,
  low:  99.8,
  close: 100.9,
  volume: 1420,
}
```

Prices may be **numbers or numeric strings**. Plenty of real sources send
strings — Laravel serialises decimal columns that way, as do several exchange
REST APIs — so they are coerced rather than rejected. Anything else (`null`,
`undefined`, booleans, objects, `'abc'`) is not a price: it is skipped, and a
chart with nothing plottable draws no price axis rather than inventing one.

Bars must be **ascending by time** and **de-duplicated**. A bar older than the
newest one is dropped rather than applied — an out-of-order tick would
otherwise overwrite the newest candle and leave a duplicate timestamp behind.

The chart infers the timeframe from the **median** gap between consecutive
bars, sampled across the dataset (or takes it from `feed.timeframe`). The
median rather than the first pair, because any exchange with a trading session
puts a large gap at each day boundary — on NSE minute data, `bars[1] - bars[0]`
across an overnight break reads as 17.75 hours.

---

## Plugging in your own data — the `DataFeed` interface

This is the seam the whole library is built around. The core never knows where
bars come from: implement two methods and it works.

```js
import { DataFeed } from 'emberwick'

class MyApiFeed extends DataFeed {
  constructor() {
    super({ symbol: 'AAPL', timeframe: 60_000 })
  }

  // Historical bars ENDING at `to` (exclusive). Return [] when exhausted.
  async getBars({ symbol, timeframe, to, limit }) {
    const qs = new URLSearchParams({ symbol, tf: timeframe, limit })
    if (to) qs.set('to', to)
    const res = await fetch(`/api/candles?${qs}`)
    return res.json()   // Bar[], ascending by time
  }

  // Live updates. Return an unsubscribe function.
  subscribe(handler) {
    const ws = new WebSocket('wss://example.com/stream')
    ws.onmessage = (e) => {
      const { bar, closed } = JSON.parse(e.data)
      handler({ type: closed ? 'append' : 'update', bar })
    }
    return () => ws.close()
  }
}

await chart.setFeed(new MyApiFeed())
```

### Feed contract

| Member | Required | Purpose |
|---|---|---|
| `symbol` | yes | Passed back to you in `getBars` |
| `timeframe` | yes | Bar duration in ms; sets the chart's time axis |
| `getBars({ symbol, timeframe, to, limit })` | yes | `Promise<Bar[]>`. `to: null` means "most recent". Return `[]` to signal no more history |
| `subscribe(handler)` | for live data | Returns an unsubscribe function |
| `prime(lastBar)` | optional | Called once after history loads, so the feed can seed its forming candle |
| `destroy()` | optional | **Yours to call.** The chart never does: `detachFeed()` and `chart.destroy()` only run the unsubscribe that `subscribe()` returned |

### Update messages

```js
handler({ type: 'update', bar })  // forming candle changed → animates
handler({ type: 'append', bar })  // a new candle opened
```

`update` is the one that produces the flowing motion. Send it as often as your
feed ticks — 500 messages between two frames still cost exactly one repaint,
because rendering is decoupled from data arrival.

### Lazy history

When the user pans to within **80 bars** of the left edge, the chart calls
`getBars({ to: oldestLoadedTime, limit: 1000 })` and prepends the result,
holding the view on the same bars. Return an empty array and it stops asking
permanently. The page size is fixed at 1000; `initialBars` sizes only the
first load.

A rejected page is retried on the next pan and only stops being requested
after three consecutive failures — subscribe to `'error'` to see them.

---

## API

### `createChart(container, options?)`

Returns a `Chart`. (`new Chart(container, options)` is equivalent.)

```js
const chart = createChart(el, {
  theme: { background: '#000', up: '#00d68f' },
  volumeRatio: 0.18,     // fraction of height for the volume strip
  magnet: true,          // crosshair snaps to nearest OHLC
  animate: true,         // live-candle easing
  touchCrosshair: true,  // tap to place, long-press to scrub (see Touch)
  touchCrosshairDelay: 350,  // ms a finger rests before a drag scrubs
  initialBars: 1500,     // first getBars() page size
  timeScale: { spacing: 9, minSpacing: 0.8, maxSpacing: 160, rightOffset: 12 },
  priceScale: { mode: 'linear', tau: 120, marginTop: 0.12, marginBottom: 0.12 },

  // Annotations can be supplied up front instead of via the setters.
  markers: [{ time: 1717070400000, shape: 'arrowUp', text: 'BUY' }],
  priceLines: [{ price: 148.2, title: 'target' }],
  zones: [{ from: 143.5, to: 145.9, label: 'value area' }],
})
```

### Methods

| Method | Description |
|---|---|
| `setData(bars)` | Replace all bars and snap to the right edge |
| `update(bar)` | Merge a tick into the forming candle (animated) |
| `append(bar)` | Open a new candle |
| `setFeed(feed)` | `async` — loads history, then subscribes. Detaches any previous feed |
| `detachFeed()` | Unsubscribe, keep the bars on screen |
| `subscribe(event, fn)` | Returns an unsubscribe fn. See events below |
| `setMarkers(markers)` | Replace every marker |
| `getMarkers()` | Current markers, normalised, each with its resolved bar index. See below |
| `addMarker(marker)` | Append one marker |
| `removeMarker(id)` | Remove by id |
| `clearMarkers()` | Remove all markers |
| `setPriceLines(lines)` | Replace every horizontal price line |
| `setZones(zones)` | Replace every shaded region |
| `markerAt(x, y)` | Hit-test plot coordinates, returns a marker or `null` |
| `setTheme(partial)` | Merge theme keys and repaint |
| `setPriceMode(mode)` | `'linear'` or `'log'` |
| `setAnimate(bool)` | Toggle live-candle easing |
| `setMagnet(bool)` | Toggle crosshair OHLC snapping |
| `visibleRange()` | The window currently on screen — the same payload the `'visibleRange'` event carries |
| `snapToRealtime()` | Jump back to the newest bar and re-enable autoscale |
| `startReplay(options?)` | Begin bar-by-bar playback. Returns the `Replay`, or `null` if there is nothing to replay |
| `stopReplay()` | Leave replay and reveal the whole dataset again |
| `replayState()` | Current playback state. `{ active: false, ... }` when not replaying |
| `chart.replay` | Getter — the active `Replay` controller, or `null` |
| `addPlugin(plugin)` / `removePlugin(plugin)` | Experimental. Attach an opt-in layer that gets its own canvas and the first offer of every gesture. See [Plugins](#plugins-experimental) |
| `toImage()` | PNG data URL of the composited layers |
| `fitContent()` | Zoom and scroll so the whole dataset is on screen. Not animated |
| `setVisibleRange({ from, to })` | Open on a window of it instead — inclusive bar indices. Not animated |
| `setTimeZone(zone)` | Format every rendered timestamp in an IANA zone, or `null` for local |
| `hideCrosshair()` | Dismiss a crosshair a tap or long-press left standing. No-op on mouse |
| `resize()` | Re-measure the container now. Resizes and pixel-ratio changes are automatic |
| `resume()` | Restart the render loop after it gave up. See below |
| `destroy()` | Remove listeners, stop the loop, drop canvases |
| `chart.fps` | Getter — measured frames per second |

### Events

```js
const off = chart.subscribe('crosshair', (payload) => {
  if (!payload) return           // pointer is on no pane
  const { index, bar, price, pane } = payload   // `price` is in THAT pane's scale
  legend.textContent = `O ${bar.open} H ${bar.high} L ${bar.low} C ${bar.close}`
})
off()  // unsubscribe
```

| Event | Payload |
|---|---|
| `'crosshair'` | `{ index, bar, price, pane }`, or `null` when the pointer is on no pane — off the plot, on the time axis, or in the seam between two |
| `'markerHover'` | The marker under the pointer, or `null` when none is |
| `'markerClick'` | The clicked marker. Only fires on a hit, never with `null` |
| `'visibleRange'` | `{ from, to, fromTime, toTime, barCount, spacing, settled }` |
| `'replay'` | `{ active, playing, index, length, progress, speed, time, bar, atEnd }` |
| `'error'` | The thrown value from a failed feed read. See below |

A drag that happens to end on top of a marker does not fire `'markerClick'` —
panning and clicking stay distinct.

### Feed errors

`getBars()` is your code, so it can reject — a 502, an expired token, an
aborted request. Both paths that call it (`setFeed()` and the lazy history
paging) route a rejection to `'error'` rather than letting it escape as an
unhandled rejection:

```js
chart.subscribe('error', (err) => {
  toast('Could not load market data')
  console.error(err)
})
```

With no `'error'` subscriber the failure is logged to the console instead of
vanishing. `setFeed()` itself never rejects, so `await chart.setFeed(feed)`
is safe to leave unguarded; subscribe to `'error'` to react to the failure.

A failed history page retries on the next pan, and stops being requested only
after three consecutive failures — one transient 500 does not permanently
disable lazy history.

### Frame errors

`'error'` also fires if the render loop gives up. A single throwing frame is
recovered automatically: the pending layers are put back and the frame is
retried. Ten *consecutive* failures — a lost canvas context, say — stop the
loop instead of spinning at 60fps, and that is reported here:

```js
chart.subscribe('error', (err) => {
  console.error(err)
  // once the cause is dealt with:
  chart.resume()
})
```

`resume()` returns `false` if the chart is destroyed or the loop is already
running, so it is safe to call blindly. Nothing else revives a stopped loop —
not even `invalidate()` — because a chart on a live feed would otherwise
re-enter the failure on every tick.

### Tracking the visible range

`'visibleRange'` is a **state** event rather than a notification, which makes it
usable without any debouncing of your own:

- A new subscriber is called **immediately** with the current window, so it
  never has to wait for the user to pan before it knows what is on screen.
- It then fires **only when the window actually changes**. Indices are
  integers, so a slow pan at 9px/bar produces roughly one event every nine
  frames, not one per frame.
- `spacing` is reported but is deliberately *not* part of the change test — it
  is a float that moves every frame of an eased zoom, and keying on it would
  turn this into a 60/sec firehose. Use it for level-of-detail decisions.
- `settled` *is* part of the change test, so the final event of a gesture
  always arrives with `settled: true`. That makes "wait until the view stops
  moving, then do the expensive thing" a safe pattern.

```js
const off = chart.subscribe('visibleRange', async (r) => {
  // paginate backwards when the user approaches the left edge
  if (r.from < 50 && r.settled && r.fromTime) {
    const older = await myApi.bars({ to: r.fromTime, limit: 500 })
    chart.setData(older.concat(chart.bars))
  }
})
```

Syncing a second chart is the other common use — feed `fromTime`/`toTime`
straight into the other instance. And `chart.visibleRange()` returns the same
payload on demand if you would rather poll than subscribe.

> The chart also paginates backwards **on its own** through
> `feed.getBars({ to })` whenever you have attached a feed. This event is for
> when you want to drive that yourself, or to drive something other than data.

---

## Replay

Play a fixed dataset back bar by bar — backtesting playback, a market-open
recap, a training drill.

```js
chart.setData(bars)

const replay = chart.startReplay({ from: 200, speed: 4 })
replay.play()

chart.subscribe('replay', (s) => {
  scrubber.value = s.index
  clock.textContent = new Date(s.time).toLocaleTimeString()
  if (s.atEnd) playBtn.textContent = 'Restart'
})
```

The chart is never put into a special mode. The controller keeps the dataset
aside and hands the chart only the **revealed prefix**, so scales, crosshair,
annotations and `'visibleRange'` behave exactly as they do on live data that
happens to end at the cursor.

Revealing the next bar goes through the same path a feed tick takes, so the
candle grows in and the axis glides. Scrubbing swaps the prefix and jumps —
easing a scrub would read as lag, the same rule the pan gesture follows.

### `chart.startReplay(options?)`

| Option | Default | Notes |
|---|---|---|
| `bars` | the chart's current bars | The dataset to replay. Never mutated |
| `from` | midpoint | Starting cursor index |
| `speed` | `1` | Multiplier, clamped to `0.25`–`500` |
| `baseInterval` | `1000` | Real ms one bar takes at 1× |
| `loop` | `false` | Restart at the end instead of stopping |
| `follow` | `true` | Re-anchor the right edge on the cursor when scrubbing |

Returns the `Replay`, or `null` when there are fewer than two bars. While a
replay is active an attached feed is ignored, so live ticks cannot fight the
cursor; `stopReplay()` restores the full dataset and resumes normal service.

`setData()` also ends a replay — new data means the dataset being replayed no
longer exists. The controller you were handed is detached at that point and
its transport methods become no-ops, so check `chart.replay` rather than
holding the old reference. Calling `startReplay()` twice detaches the first
controller the same way.

### Transport

Every method returns the controller, so calls chain.

| Method | Description |
|---|---|
| `play()` / `pause()` / `toggle()` | Pressing play at the end restarts from the beginning |
| `seek(index)` | Move the cursor. Out-of-range values clamp |
| `step(n = 1)` | Relative move; `step(-1)` goes back a bar |
| `toStart()` / `toEnd()` | Jump to either end |
| `setSpeed(x)` | Clamped to `0.25`–`500`. Never bursts bars on a rate change |
| `setLoop(bool)` | Toggle looping |

Readable state: `index`, `length`, `progress` (0–1), `speed`, `time`, `bar`,
`atEnd`, `playing`, and `interval` (real ms between bars at the current
speed).

### The `'replay'` event

`{ active, playing, index, length, progress, speed, time, bar, atEnd }`.

Like `'visibleRange'` it is a **state** event: a new subscriber is called
immediately, and after `stopReplay()` it fires once with `active: false` so a
UI can reset itself without special-casing teardown. `chart.replayState()`
returns the same payload on demand.

**Markers after the cursor are hidden, not clamped.** Time→index resolution
snaps to the nearest bar, so without that filter every future trade would pile
onto the newest revealed candle — and a replay that shows you tomorrow's
entries is worse than no replay at all.

The cursor never goes below index 1: the scales infer the timeframe from the
first pair of bars.

---

## Series

Candles are not the only thing worth drawing on a price axis. A **series** is
an arbitrary y-value over the same time axis — a moving average, a VWAP, an
equity curve, a band.

```js
chart.setSeries('ema20', {
  data: [{ time: 1717070400000, value: 148.2 }, ...],
  color: '#c084fc',
})
chart.setSeries('sma50', { data: sma50, color: '#38bdf8', lineWidth: 1 })
```

Series are **keyed**, so updating one leaves the rest alone — a panel of
twelve indicators does not rebuild eleven of them to toggle the twelfth.
Insertion order is draw order, and they paint over the candles but under
price lines and markers.

| Method | Description |
|---|---|
| `setSeries(id, options)` | Create, or update in place. Omit `data` to change only presentation |
| `setSeriesData(id, points)` | Replace the points, keep the options |
| `setSeriesVisible(id, bool)` | Hide without discarding. Hidden series do not autoscale |
| `removeSeries(id)` | Drop one |
| `clearSeries()` | Drop all |
| `getSeries()` | Each series' resolved options, in draw order |

| Option | Default | Notes |
|---|---|---|
| `data` | — | `{ time, value }[]`. `time` is ms epoch, resolved to the nearest bar |
| `pane` | `'price'` | Which pane draws it. Throws if that pane does not exist |
| `color` | `theme.textStrong` | |
| `lineWidth` | `1.5` | |
| `lineStyle` | `'solid'` | `'solid'`, `'dashed'`, `'dotted'` |
| `stepped` | `false` | Draw as a step function instead of interpolating |
| `visible` | `true` | |
| `title` | — | Passthrough metadata for `getSeries()`. Never drawn |

### Gaps

**A point with no value lifts the pen.** `value` absent, `null`, or anything
non-numeric ends the current line; the next valued point starts a fresh one.

```js
chart.setSeries('rsi', { data: [
  { time: t0, value: 55.2 },
  { time: t1 },              // no value here — the line breaks
  { time: t2, value: 61.8 },
]})
```

This is the one design decision worth stating plainly: a missing value is
**never** drawn as zero and **never** interpolated across. An indicator with
no value during its warm-up period is not an indicator sitting at zero, and a
line that quietly connects across a gap is a line that lies about the data.

### Scale

Visible series widen the price scale along with the bars, so a value outside
the candle range is in view rather than clipped at the edge. Hidden series are
excluded from that. Points more than one timeframe outside the loaded bar
range are not drawn at all, on the same reasoning as markers.

Series share the price axis with the candles. An equity curve at 200,000
against a price around 100 will technically render, but the candles will be a
flat line — a second pane with its own scale is the answer, and it does not
exist yet.

---

## Panes

An oscillator cannot share a scale with a price. RSI lives on 0–100 and MACD
around zero; put either on a chart of an instrument trading at 24,000 and the
candles collapse into a flat line.

A **pane** is a horizontal band with its own price scale, sharing the time
axis with every other pane.

```js
chart.addPane('rsi', { weight: 1 })
chart.setSeries('rsi14', { data: points, pane: 'rsi', color: '#c084fc' })
```

| Method | Description |
|---|---|
| `addPane(id, options)` | Add a band below the existing ones. Returns its `PaneInfo` |
| `removePane(id)` | Remove it, and every series routed to it |
| `panes()` | Every pane, top to bottom. `panes()[0]` is always the price pane |
| `pane(id)` | One pane, or `null` |
| `paneScale(id)` | That pane's live `PriceScale` |
| `paneRect(id)` | A copy of its rect, in CSS px |

| Option | Default | Notes |
|---|---|---|
| `weight` | `1` | Flex share of the plot height. The price pane is `3` |
| `minHeight` | `40` | Floor in CSS px |
| `priceScale` | chart's | This pane's scale options |
| `title` | — | Passthrough metadata. Not drawn |

`'price'` is the pane candles, volume, markers, price lines and zones always
draw on. It cannot be removed, and it is always the top band.

**An unknown pane id throws.** Defaulting to the price pane would put an RSI at
50 through a 24,000 scale and flatten the candles — exactly the failure panes
exist to prevent, arriving with no error at all.

A pane whose series are all hidden, or which has none, draws no axis rather
than inventing one — the same rule the price pane follows with no bars.

### Migrating from `chart.ps` and `chart.plot`

Both still work and still address the price pane. `paneScale('price')` and
`paneRect('price')` are the replacements, and they say which pane they mean:

```js
const y = chart.paneScale('rsi').y(70)     // where 70 sits in the RSI pane
const band = chart.paneRect('rsi')         // { x, y, w, h }
```

One difference worth knowing: `chart.plot` is a live rect mutated in place, so
a reference held across a resize stays correct. `paneRect()` returns a copy.

---

## Annotations

Three independent collections, each replaced wholesale. Zones paint behind the
candles; price lines and markers paint in front.

```js
chart.setMarkers([
  { time: 1717070400000, shape: 'arrowUp',   text: 'BUY 120',
    data: { orderId: 'A-7741' } },
  { time: 1717074000000, shape: 'flag',      text: 'Earnings', color: '#c084fc' },
  { time: 1717077600000, shape: 'arrowDown', text: 'SELL 160' },
])

chart.setPriceLines([
  { price: 148.20, title: 'target', color: '#26a69a' },
  { price: 141.05, title: 'stop', lineStyle: 'dotted' },
])

chart.setZones([
  { from: 143.5, to: 145.9, label: 'value area' },
])

chart.subscribe('markerClick', (m) => openTicket(m.data.orderId))
```

### Markers

A marker is pinned to a **timestamp**, not a bar index, and resolves to the
nearest bar. Load an older page of history and every marker re-resolves, so
nothing drifts off its candle.

Supply your own `id` if you have one. A generated id is derived from the
marker's own identity rather than its array position, so passing the same
markers to `setMarkers()` twice yields the same ids and an id captured for
`removeMarker()` stays valid.

A marker more than one timeframe outside the loaded range is **hidden**, not
clamped to the end bar. A trade from six months before the loaded window is
not an event that happened at the left edge of the chart, and drawing it there
is worse than not drawing it at all. Page that history in and it appears.

| Field | Default | Notes |
|---|---|---|
| `time` | *required* | ms since epoch, snapped to the closest bar |
| `id` | derived | Stable across calls — see below |
| `id` | generated | Needed for `removeMarker(id)` |
| `shape` | `'circle'` | See the list below |
| `position` | shape-dependent | `'aboveBar'`, `'belowBar'`, `'inBar'`, `'atPrice'` |
| `price` | — | Only used when `position` is `'atPrice'` |
| `color` | `theme.up` / `theme.down` | Down-pointing shapes default to the down colour |
| `text` | — | Short caption. For `'label'` it is drawn inside the pill |
| `textColor` | theme | Caption colour |
| `size` | `1` | Scale factor |
| `data` | — | Anything. Handed straight back on hover and click |

Shapes: `arrowUp`, `arrowDown`, `triangleUp`, `triangleDown`, `circle`,
`square`, `diamond`, `flag`, `label`.

Position defaults follow the trading convention: up-pointing shapes sit
*below* the bar, down-pointing shapes *above* it, everything else above.

**When `index` is resolved.** `getMarkers()` hands back the normalised
markers, but time→index resolution happens in the render frame, not in
`setMarkers()`. Call them back to back and every `index` is still `-1`; it is
populated after the next frame. `-1` also means *deliberately hidden* — a
marker more than one timeframe outside the loaded range resolves to `-1`
rather than clamping onto an end bar — so treat it as "not drawn", not as
"not yet known".

**Ids.** Supply your own, or let one be derived from the marker's identity
(time, shape, and which duplicate it is). Derived ids are stable across
`setMarkers()` calls, page loads and two charts showing the same data, so an
id captured for `removeMarker()` stays valid.

**Overlap and density.** Markers sharing a bar are stacked rather than drawn on
top of each other. Once a candle body is 3px wide or less — around 5.6px per
bar, since a body is 72% of the slot — dense runs thin to roughly one marker
per 4px — a thousand trades stay legible and stay fast. A marker on the
forming candle anchors to the animated values, so it flows with the live bar.

### Price lines

| Field | Default | Notes |
|---|---|---|
| `price` | *required* | |
| `color` | `theme.textStrong` | |
| `lineStyle` | `'dashed'` | `'solid'`, `'dashed'`, `'dotted'` |
| `lineWidth` | `1` | |
| `lineVisible` | `true` | `false` keeps the title pill and axis tag but draws no rule |
| `title` | — | Pill drawn at the left end |
| `axisLabel` | `true` | Price tag on the axis |

### Zones

Supply `from`/`to` for a **price band** spanning the full width, or
`fromTime`/`toTime` for a **time band** spanning the full height.

| Field | Default | Notes |
|---|---|---|
| `from` / `to` | — | Price band bounds. Non-finite values are skipped silently |
| `fromTime` / `toTime` | — | Time band bounds, ms epoch, resolved to the nearest bar |
| `color` | theme-derived | Fill |
| `border` | — | Stroke around the band; omitted when unset |
| `label` | — | Drawn at the top-left corner of the band |

```js
chart.setZones([
  { from: 143.5, to: 145.9, label: 'value area' },
  { fromTime: 1717070400000, toTime: 1717074000000,
    color: 'rgba(239,83,80,0.07)', border: 'rgba(239,83,80,0.3)' },
])
```

Autoscale fits the **bars**, not the annotations — a price line far outside the
data range is simply off-screen. Derive extreme values from the visible range
if you need them guaranteed visible.

---

## Drawing tools

Trendlines, levels, Fibonacci, channels, ranges, measures, positions and text,
drawn on the chart by the reader and stored as plain data by you. They are a
separate entry, `emberwick/drawings`, so a chart that never imports it carries
none of the code (see [Size and opt-in](#size-and-opt-in)).

### Enabling

```js
import { createChart } from 'emberwick'
import { enableDrawings } from 'emberwick/drawings'

const chart = createChart(el)
const drawings = enableDrawings(chart)

drawings.setTool('trendLine')          // the reader clicks or drags on the chart
drawings.subscribe('change', () => save(drawings.getDrawings()))
```

`enableDrawings(chart, options?)` gives you the nine standard tools.
`createDrawings(chart, { tools: [trendLine, fibRetracement] })` gives you
exactly the tools you pass, and takes no default on purpose: a default
parameter would keep all nine alive in every bundle that imports the function,
and the tools tree-shake only if nothing names them.

A second `enableDrawings` on the same chart throws until the first controller
is `destroy()`ed. That is deliberate: React StrictMode runs an effect, its
cleanup and the effect again, and the second run must get a fresh controller,
never the destroyed one.

Options, all optional:

```js
enableDrawings(chart, {
  drawings: saved,          // initial load; not undoable, see "Saving and loading"
  magnet: 'inherit',        // 'inherit' | 'off' | 'weak' | 'strong'
  stickyTools: false,       // keep the tool armed after each drawing
  quickMeasure: true,       // Shift+click-click measures with no tool armed
  keyboard: true,           // Delete, arrows, Ctrl/Cmd+Z ... while the chart has focus
  textEditor: true,         // false hands text editing to you through 'edit'
  historyLimit: 100,        // undo depth
  motion: 'auto',           // 'auto' | 'full' | 'reduced' | 'none'
  readOnly: false,          // render, hover, select and events, but no edits
  defaults: { trendLine: { style: { lineWidth: 2 } } },  // per-type starting style/options
  theme: { accent: '#ff8a00' },                          // see "Styling"
  maxDrawings: 5000,        // rows past it are rejected with reason 'limit'
})
```

`platform`, `prefersReducedMotion` and `idFactory` are also injectable, for
tests and for hosts that mint their own ids.

### Tools and presets

Nine stored types, fourteen presets. A preset is a type plus the options it
starts with, and variants share a type on purpose: a ray is a trend line whose
`extend` is `'right'`, so the reader can turn it back into a segment after
drawing it, and you store one kind of row for both.

| Preset (`setTool`) | Stored `type` | What it draws |
|---|---|---|
| `trendLine`, `ray`, `extendedLine`, `arrow` | `trendLine` | Two points. Optional extension to either side, arrow caps, and a live `+12.40 (+1.52%) · 38 bars · 6h 20m` readout |
| `horizontalLine`, `horizontalRay` | `horizontalLine` | One price. A tag on the price axis, and draggable by that tag |
| `verticalLine` | `verticalLine` | One moment, across every pane (or its own pane only), with a time tag |
| `rectangle` | `rectangle` | Two corners. Fill, optional middle line, optional stats |
| `parallelChannel` | `parallelChannel` | A baseline, then a click for the parallel. The second click has an auto-fit magnet to the highest high or lowest low between the ends |
| `fibRetracement` | `fibRetracement` | Standard levels 0 to 1 visible, 1.272, 1.618 and 2.618 hidden; each level's colour and visibility is stored. Linear or log interpolation |
| `measure` | `measure` | Price change, percent, bars, duration and volume across a box |
| `long`, `short` | `position` | Entry, target and stop. One click makes a bracket sized from the 14-bar ATR (1.5 ATR stop, 2R target); a press-drag sets the target and mirrors the stop. Reads `R:R`, and once the bars after the entry reach the target or the stop, says which happened |
| `text` | `text` | A note, edited in place |

`TOOL_PRESETS` is exported with each preset's `label` and `group`, so a
toolbar can be built from it rather than kept in step with it by hand. (The
demo's rail is.)

A few behaviours worth knowing before they surprise you:

- **The position tool is honest about a bad stop.** A stop on the wrong side of
  the entry is allowed, because clamping or flipping user data hides the
  mistake. Both zones turn magenta (`theme.warn`), the label reads `R:R —`, and a one-shot pulse
  plays as it crosses over. Nothing pulses again afterwards.
- **A stop and a target in one bar count as the stop**, and the label says
  `(same bar)`. Bars alone cannot say which came first, and the pessimistic
  reading is the one to build a review on.
- **Everything that reads OHLC or volume reads revealed bars only**, so a
  position replayed through history flips to "Target hit" on the step that
  reveals it, not before.

### Drawing with a mouse

| Input | Action |
|---|---|
| Pick a tool, click and drag | Draws it (release to finish) |
| Pick a tool, click, move, click | Also draws it: a quick click-click places both ends |
| Click a drawing | Selects it. Handles appear |
| Drag a handle | Reshapes; the opposite corner or edge of a rectangle stays put and flips cleanly when passed |
| Drag a selected drawing's body | Moves it |
| `Alt` + drag a body | Drags a copy |
| Double-click a text | Edits it; on any other drawing, fires `'edit'` |
| `Shift` + drag, no tool armed | Quick measure: an ephemeral measure that is never in the document, the history or the events |
| Right-click a drawing | Selects it and fires `'contextmenu'` (the browser's menu opens only while nobody is subscribed, and on empty chart) |
| `Shift` while placing | Constrains to 0°, 45° or 90° on screen |
| `Alt` while placing | Free: no snap at all |
| `Ctrl` (`Cmd` on macOS) while placing | Inverts the magnet for that gesture |

On a mouse, pressing an unlocked drawing selects it and claims the press, so a
drawing can be picked up and dragged in one motion. A locked drawing is never
claimed, so the chart pans through it; a click still selects it, so it can be
unlocked. Cursors and handle sizes follow the pointer type.

### Drawing on a phone

A finger cannot hover and a phone plot is mostly fill once a box is selected,
so the touch rules differ on purpose:

| Gesture | Action |
|---|---|
| Tap a drawing | Selects it. It does not move, and does not place the crosshair |
| Drag a selected drawing by a handle, its border, its label or its move handle | Reshapes or moves it |
| Swipe inside a selected box's fill | Pans, exactly as before. A fill never claims a one-finger press |
| Tool armed, one finger | Draws. One-finger pan is off while a tool is armed |
| Tool armed, two fingers | Pans and pinch-zooms, and cancels the in-flight press without leaving a mark |
| Tap empty chart | Deselects |

Area tools and trend lines get a **move handle** at their centre, drawn as a
four-way glyph, because on touch the body of a fill is not a place you can
drag. A handle's hit target is 44 pt, and the point being placed sits under
the finger without jumping. Tap-to-select-then-drag, rather than
press-and-drag straight away, is what keeps a chart with a few boxes on it
scrollable with one finger.

### From the keyboard

Keys reach drawings only while the chart has focus, which `setTool` and
`select` give it (pass `{ focus: false }` if you select from a list with its own
keyboard handling). `keyboard: false` turns all of this off.

| Key | Action |
|---|---|
| `Esc` | One layer at a time: revert a drag, then cancel a creation, then close the editor, then close a quick measure, then deselect, then disarm |
| `Delete` / `Backspace` | Remove the selection; the last placed point while placing a channel. A locked drawing shakes instead |
| `Ctrl`/`Cmd` + `Z` | Undo (during a gesture it only cancels the gesture) |
| `Ctrl`/`Cmd` + `Shift` + `Z`, `Ctrl` + `Y` | Redo |
| `Ctrl`/`Cmd` + `D` | Duplicate, five bars to the right |
| `←` `→` | Nudge one bar (`Shift`: ten). Without a selection they pan, as always |
| `↑` `↓` | Nudge one pixel of price (`Shift`: ten) |
| `Enter` on a text | Edit |

Consecutive nudges of one drawing are one undo step, coalesced without a
clock, so it does not depend on how fast anybody types.

### Snapping and magnet

While placing or dragging a point, the first of these that applies wins:

1. **`Alt`**: free, no snap.
2. **`Shift`**: a screen angle of 0°, 45° or 90° from the fixed end. At 0° the
   price is copied bit for bit, so a horizontal trend line is exactly
   horizontal.
3. **Another drawing's anchor**: an exact copy of that point, offsets included.
4. **Levels**: horizontal lines, fib levels, position entry/target/stop, your
   `priceLines`, and the channel's auto-fit. An alignment guide is drawn when
   another anchor's price is within 4 px.
5. **The OHLC magnet**: a candle's open, high, low or close, ordered by what
   the tool prefers (a fib wants highs and lows).
6. **The bar slot.**

`magnet` is `'inherit'` by default: it follows `chart.options.magnet`, where
`true` means weak, so the crosshair and the drawings agree with one setting and
one reach. `'weak'` snaps within 22 px (28 on touch) and `'strong'` always
takes the nearest. The **platform modifier** (`Cmd` on macOS and iOS, `Ctrl`
elsewhere; not `Ctrl` on macOS, where Ctrl+click is a secondary click) inverts
the magnet for the current gesture. On a sub-pane the magnet reads that pane's
visible series values instead of candles.

Once a snap has engaged it releases only past 1.5 times its reach, so the
point does not flicker at the boundary. When the kind of snap changes the point
glides and a ring pops; a change of bar slot never glides (see
[How the motion works](#how-the-motion-works)).

### Saving and loading

```js
const rows = drawings.getDrawings()       // z-ascending deep clones, plain JSON
const report = drawings.setDrawings(rows) // a load: see below
```

A drawing looks like this. `getDrawings()` returns the keys in this order, and
`add()` needs only `type` and `points`:

```js
{
  v: 1,                          // schema version, PER DRAWING
  id: 'dkq1z0xm04ab',
  type: 'trendLine',
  pane: 'price',
  points: [
    { time: 1717070400000, price: 148.2 },
    { time: 1717077600000, price: 151.05 },
  ],
  style: { color: null, lineWidth: 1.5, lineStyle: 'solid', fill: null,
           fillOpacity: 0.12, textColor: null, fontSize: 12 },
  options: { extend: 'right', startCap: 'none', endCap: 'none', stats: 'active', text: '' },
  locked: false,
  visible: true,
  z: 4,                          // sparse; bringToFront is max + 1
  meta: { ... },                 // yours: JSON-cloned, never read
}
```

- **`time` is in your bars' unit and epoch, and is never converted.** If your
  bars are milliseconds, so is this. If they are IST read as if it were UTC
  (see [Time zones](#time-zones)), so is this. Store what you were given.
- **`color: null` follows the theme**, so a light/dark switch recolours the
  drawing. A stored colour is used as is.
- **`options` is the full normalised set**, not a sparse diff, so changing a
  default later never restyles what was already saved.
- **One row per drawing, one `v` per row.** If you keep a table of drawings,
  each row carries its own schema version. Additive fields keep `v: 1`; only a
  change that an older build would misread bumps it.
- **Unknown keys are carried.** Keys this build does not know, at the top level
  and inside `style` and `options`, are kept and written back by
  `getDrawings()`, and survive an `update()`. So a build that nudges a drawing
  saved by a newer one writes back everything the newer one wrote.
- **`z` is sparse and explicit**, so reordering rewrites one row rather than
  renumbering the table.

`setDrawings` accepts an array, `{ drawings: [...] }`, a JSON string, or
`null`/`undefined` (an empty document, not an error). A string that does not
parse throws and applies nothing.

**`setDrawings` is a load, not an edit.** It clears the undo history and the
selection, aborts any gesture, and fires **no `change` event**. That is the
point of it: if it did, a save-on-change host would write the half-loaded
document straight back over the stored one. It does emit the `select` and
`history` state events if those changed, and it returns a `LoadReport`, also
kept as `drawings.lastLoadReport`:

```js
{
  loaded: 12,                     // drawings of a known type accepted
  carried: ['d7'],                // ids of rows this build cannot read (below)
  rejected: [{ index: 3, id: 'd9', reason: 'too few points' }],
  renamed: [{ index: 5, from: 'd2', to: 'd2:2' }],   // duplicate ids get a suffix
  truncated: [],                  // extra points or oversized unknown keys dropped
  orphaned: [],                   // drawings on a pane that does not exist (yet)
}
```

What comes back always accounts for every row it kept:
`getDrawings().length === report.loaded + report.carried.length`. The
`drawings` option loads the same way, and logs one `console.warn` if anything
was rejected.

**Inert drawings.** A row with an unknown `type`, or a `v` newer than this
build, is *carried verbatim*: never drawn, hit, selected or edited, but always
returned by `getDrawings()` in its z slot. `remove()` and `clear()` skip it and
do not count it. A save-on-change host can therefore never delete a newer
build's data by opening its document in an older one.

**Orphans.** Removing a pane does not delete the drawings on it: they are kept,
serialized, not drawn and not hit, and listed by `drawings.orphans()`. They
come back when a pane with that id is added again.

**Editing through the API:**

| Method | Notes |
|---|---|
| `add(input, { history, select, animate })` | Returns the id. Throws on invalid input, on a duplicate `id` (carried rows included) and on an unknown pane |
| `update(id, patch, { history, animate })` | `points` are replaced; `style` and `options` merge per key (a fib's `levels` are replaced as a whole). Throws on `id`/`type`/`v` in the patch. A patch that changes nothing is a no-op returning `false`, with no history and no events |
| `remove(idOrIds)` / `clear()` | `clear` is one undo step |
| `duplicate(id, { offsetBars })` | `null` with no bars or for a carried row |
| `bringToFront(id)` / `sendToBack(id)` | |
| `setLocked(id, on)` / `setVisible(id, on)` | Sugar over `update` |
| `setHidden(on)` | Hide every drawing: a view setting, not a change to the document |
| `batch(fn)` | **Atomic.** One history entry and one `change` for everything `fn` does. If `fn` throws, the drawings and the selection are restored, nothing is recorded or emitted, and the error is rethrown |
| `priceAt(id, time)` | The price of a trend line, channel baseline or horizontal line at a time, extension included. The building block for alerts |
| `drawingAt(x, y)`, `screenBox(id)` | Hit-test in container pixels, for your own context menu; the last painted box |

Mutating the drawing that is being dragged or created (or anything that could,
like `undo()` or `setDrawings()`) first ends the gesture and reverts it, and
only then applies. Mutating another drawing leaves the gesture alone.

**The symbol-switch caveat.** The chart has no idea what symbol it shows, so it
cannot key drawings by symbol. When your host switches symbol, call
`drawings.setDrawings(saved[symbol] ?? [])` yourself. Until you do, the old
symbol's drawings sit on the new symbol's candles, which is the one hazard this
API leaves to you.

`normalizeDrawings(input, tools?)` validates a stored document with no chart,
is pure, and is safe to import on a server, so a backend can vet rows before it
stores them. Carried rows come back verbatim.

### How anchors follow your data

Drawings are stored as `{ time, price }` and resolved to a fractional bar index
through the same scales as the candles. No new scale system is involved.

| What happens | What the drawings do |
|---|---|
| Pan, zoom, inertia, autoscale, following live | Re-projected every frame from the same values as the candles. Nothing lags |
| A live tick, an `append` | Stay put. A held magnet-snapped point is re-derived |
| `setData`, with the same bars or a reshuffled interior | Re-resolved by time, including when an interior session gap moved |
| History paged in on the left | Stay under the same candles: every index shifts, and the view shifts with it |
| A point after the newest bar | Stored as `{ time: lastBarTime, price, offset: k, tf }`, "k bars after". It keeps its distance in bars across session gaps, and a bar-count point cannot know a session calendar |
| A point before the oldest bar | The mirror image, with a negative `offset`. Load older history and it lands on its real bar |
| A timeframe change | In-data points map exactly (or fractionally when unaligned); offsets rescale by `tf` |
| `startReplay`, seek, step, loop | Resolved against the replay's whole dataset, so nothing moves. Drawings past the cursor stay visible: they are your marks. Anything that reads price or volume sees revealed bars only |
| `setPriceMode('log')` | Anchors unchanged; lines stay straight on screen. A drawing with any price at or below zero is kept but not drawn |
| A sub-pane (an RSI band) | Projects through that pane's scale and is clipped to it; the magnet reads that pane's series |
| A sub-pane whose series has not loaded | A press there is not claimed, so no `0.43` "price" is ever stored |
| Zero bars (for example `setFeed` swapping symbols) | Nothing is drawn or created; drawings and selection are kept, and nudge and duplicate are unconsumed no-ops |
| `setTheme`, `setTimeZone` | Colours and labels follow. Times are formatted in your zone; stored times are untouched |

Drawings never take part in autoscale. A drag near an edge would otherwise be a
feedback loop between the thing you are moving and the scale you are moving it
on.

### Undo and redo

Undo is per drawing. Each history entry records only the ids it changed, as
frozen before and after states, so undoing one drawing's edit never clobbers
another drawing you changed since, or an edit you made with `{ history: false }`
to a different one. (An edit made with `{ history: false }` to the *same*
drawing is overwritten by an undo across it, which is the documented cost.)

`undo()`, `redo()`, `canUndo`, `canRedo` and `clearHistory()` do what they say.
A new commit clears the redo stack; the oldest entry is dropped beyond
`historyLimit`. User gestures and API edits are recorded; selection, tool
choice, hover, quick measure, text drafts and `setDrawings` are not.

Undo and redo select the surviving drawing, glide it back and give it a brief
"this changed" halo.

### Events

```js
const off = drawings.subscribe('change', ({ source, reason, created, updated, removed }) => {
  // source: 'user' | 'api' | 'history'
  save(drawings.getDrawings())
})
```

| Event | Kind | Payload | Fires |
|---|---|---|---|
| `'change'` | notification | `{ source, reason, created, updated: [{ before, after }], removed }` | **Once per commit**: the end of a gesture, an API call, an undo or a redo. Never per drag frame, never on `setDrawings`, and never for a text draft until its first non-empty commit. Carried rows never appear |
| `'drawing'` | stream | `{ phase: 'create' \| 'move' \| 'reshape', drawing, snap, stats }` | At most once per frame while a draft changes, and only if subscribed. Live readouts, such as R:R while dragging. A creation draft has `id: null` |
| `'select'` | state | `{ ids, drawings }` | On change, and on subscribe |
| `'box'` | state | `{ id, box }` for the selected drawing | Whenever its painted box moves half a pixel, and on subscribe |
| `'tool'` | state | `{ tool, sticky }` | On change (including the auto-disarm after a non-sticky create), and on subscribe |
| `'history'` | state | `{ canUndo, canRedo, undoSize, redoSize }` | On change, and on subscribe |
| `'edit'` | notification | `{ id, drawing, box }` | A double-click on a non-text drawing, or text creation with `textEditor: false` |
| `'contextmenu'` | notification | `{ id, drawing, part, x, y, event }` | A right-click or long-press on a drawing, which is selected first |

`change` reasons are `create`, `move`, `reshape`, `style`, `options`, `text`,
`lock`, `visibility`, `order`, `remove`, `clear`, `duplicate`, `nudge`,
`batch`, `undo` and `redo`.

Two of these exist for a specific job, and it is worth being clear which:

- **`change` is for saving.** It is a notification, it is coarse on purpose,
  and it is safe to debounce.
- **`drawing` is for showing.** It is a stream at frame rate for a readout, and
  it is not a substitute for `change`: a gesture that is cancelled emits
  `drawing` and never `change`.
- **`box` is for a floating toolbar.** It fires from the chart's own frame,
  so a toolbar that moves *inside* the callback stays glued to the drawing
  through a pan, a zoom and an autoscale ease, none of which change
  `visibleRange`. Write the position straight to the element rather than through
  framework state, or the toolbar trails by a frame. The Playground does this.

Every listener runs in a `try`/`catch` (a throw is logged as `[Emberwick]
'drawings:<event>' listener threw`), and **all state is committed before the
first event fires**, so a listener may call back into the controller. Within
one operation the order is `change`, `history`, `select`, `tool`.

### Styling

```js
drawings.setDefaults('trendLine', { style: { color: '#c084fc', lineWidth: 2 } })
drawings.update(id, { style: { lineStyle: 'dashed' } })
```

A drawing's `style` is `color`, `lineWidth` (0.5 to 8), `lineStyle`
(`'solid' | 'dashed' | 'dotted'`, the same names and dashes as price lines and
series), `fill`, `fillOpacity`, `textColor` and `fontSize` (9 to 32). What each
tool reads is its own business: a position takes its zones from the theme's
up and down colours, so its `color` does nothing.

The drawing theme is derived from the chart theme and nothing is added to
`defaultTheme`. Override any key with the `theme` option:

`line`, `accent`, `handleFill`, `halo`, `labelBg`, `labelText`, `tagText`,
`up`, `down`, `warn`, `guide`, `font`, `textColor` and `fib` (an array of level
colours).

Three optional keys on the chart theme itself feed it, so one `setTheme` can
carry them: `drawingLine`, `drawingAccent` and `drawingFib`. The accent is an
ember amber, deliberately unlike the up and down colours. The wrong-side
position colour (`warn`) is a magenta, distinct from the accent, up and down on
both backgrounds; the `R:R —` label still says it in words.

### Motion

Drawings are held to the same rule as the rest of the chart: motion that is
glued to the data.

- Anchors never move by themselves, and nothing eases the data-to-pixel
  mapping. Every frame projects a drawing through the same scales as the
  candles.
- What *does* glide is a **residual**, kept in data space (bars, and price) and
  settling to zero. A snap changing kind, an undo or redo, a nudge, an API
  `update(..., { animate: true })`, the slop catch-up on touch and a cancelled
  drag all seed one. Because it is in data units, a residual stays glued to the
  candles even if the view zooms mid-glide, and it stops the loop as soon as it
  is under 0.1 px.
- **Dragging is crisp.** A change of bar slot, or of the magnet's target from
  one bar to the next, never glides, because a glide would trail the pointer.
  The house rule that a drag jumps applies here too.
- Selection handles pop in staggered, hover fades, fib levels stagger in, a new
  horizontal line grows from where you clicked, a deleted drawing fades out,
  and a locked drawing shakes when you try to change it.

`motion: 'auto'` follows `chart.options.animate` (`setAnimate(false)` turns it
off at runtime) and the browser's `prefers-reduced-motion`. `'reduced'` drops
residuals, overshoot, ripples, stagger, reveals, shakes and pulses, and keeps
short fades of 120 ms or less. `'none'` finishes everything at once and keeps
**no** frames alive. Colours change instantly in every mode.

An armed tool under a still mouse costs zero frames, and so does a selected
drawing once its handles have popped in. Only the `plugins` canvas repaints for
a hover or a selection, so the candles are never redrawn for it.

### Custom tools

A tool is a plain object, a `ToolDef`. The nine standard ones are written
against exactly this contract and get no private access. It is
**experimental**: this is the part of the drawings API most likely to change
before 1.0.

```js
const pin = {
  type: 'pin', label: 'Pin', anchors: 1, creation: 'single',
  snapPrefs: ['close', 'high', 'low', 'open'], prefBoost: 1,
  defaultStyle: { color: null, lineWidth: 1.5, lineStyle: 'solid', fill: null,
                  fillOpacity: 0, textColor: null, fontSize: 12 },
  defaultOptions: { label: '' },
  // a NEW object with known keys only, and idempotent: the keys of what this
  // returns are the "known" options; anything else is carried
  normalizeOptions: (raw) => ({ label: typeof raw?.label === 'string' ? raw.label.slice(0, 40) : '' }),

  // anchors arrive already projected through the pane's scales
  project(d, anchors, ctx, out) {
    const a = anchors[0]
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return false   // nothing visible
    out.x = a.x; out.y = a.y
    out.infinite = false
    out.bbox = { x0: a.x - 6, y0: a.y - 6, x1: a.x + 6, y1: a.y + 6 }
    return true
  },
  // assign absolute values: never read canvas state back
  draw(c, g, d, look, ctx) {
    c.globalAlpha = look.alpha
    c.fillStyle = d.style.color || ctx.theme.line
    c.beginPath(); c.arc(g.x, g.y, 4 + 2 * look.hover, 0, Math.PI * 2); c.fill()
    if (d.options.label) { c.font = ctx.theme.font; c.fillText(d.options.label, g.x + 8, g.y + 4) }
  },
  hit: (g, x, y, tol) => (Math.hypot(x - g.x, y - g.y) <= tol + 4 ? { part: 'body' } : null),
  handles: (g, d, out) => { out[0] = { x: g.x, y: g.y, index: 0, axis: 'xy', cursor: 'grab' }; return 1 },
  dragHandle: (d0, index, snapped) => [snapped.point],
}

const drawings = createDrawings(chart, { tools: [trendLine, pin] })
drawings.add({ type: 'pin', points: [{ time, price }], options: { label: 'entry' } })
```

`project` is the single source of geometry for `draw`, `hit`, `handles` and the
export, so what is drawn is what is hit. Optional members add `complete` (expand
a click into more points), `dragBody`, `bleed` (how far your pixels reach past
the anchors, so culling never pops you out mid-pan), `angleOrigin`,
`snapTargets`, `axisTags`, `stats` and `priceAt`. A custom tool has no preset:
arm it with `setTool('pin')`. A drawing whose tool throws is marked broken and
skipped, reported once through the chart's `'error'` event, and never blanks
the others; the reader can still select and delete it. See
`src/drawings/index.d.ts` for the full contract.

### Framework recipes

There is no adapter code: importing drawings from the React or web-component
entry would ship them to everyone who uses those. Each recipe **enables
synchronously** and loads afterwards, so an unmount during the load can never
destroy a chart and then enable drawings on it, and the `LoadReport` stays
reachable.

**React**

```jsx
import { EmberwickChart } from 'emberwick/react'
import { enableDrawings } from 'emberwick/drawings'

useEffect(() => {
  const d = enableDrawings(ref.current.chart)
  let live = true
  api.load(id).then((rows) => { if (live && !d.destroyed) setReport(d.setDrawings(rows)) })
  const off = d.subscribe('change', save)
  return () => { live = false; off(); d.destroy() }
}, [id])
```

The parent's effect runs after the child adapter's, so `chart` already exists.
StrictMode's second run gets a fresh controller because `destroy()` released
the first.

**Web component.** Call `enableDrawings(el.chart)` after the element connects.
Disconnecting and reconnecting re-creates the chart, so persist through
`change` and enable again.

**Vue 3** (as Traed does):

```js
onMounted(async () => {
  drawings = enableDrawings(chart)                    // synchronous: exists before any await
  drawings.subscribe('change', debounce(() => api.save(id, drawings.getDrawings()), 400))
  const rows = await api.load(id)
  if (!drawings.destroyed) report.value = drawings.setDrawings(rows)
})
onBeforeUnmount(() => { drawings?.destroy(); chart?.destroy() })
```

The controller carries `__v_skip`, so Vue never deep-proxies it, and drawings on
an RSI pane work as they are.

### Size and opt-in

Stated plainly, with numbers measured by `npm run size` (gzipped):

- **No drawing code is in the core.** A chart that never imports
  `emberwick/drawings` carries none of it, and CI builds the core with and
  without the drawings entry and fails unless `index.js` and its source map
  come out **byte-identical**.
- **The plugin seam is generic and cost the core +4.2 KB** in the unminified
  ESM (36.0 KB, from 31.8) and +2.6 KB in the minified UMD (20.3 KB, from 17.7)
  when it arrived in 0.12. It is larger than the ~2.6 KB first estimated because
  the ESM keeps the comments, and the gesture handling is where the comments
  are. With no plugin attached it costs **nothing at runtime**: three canvases,
  and one length check per input hook. 0.13 added a layer under the candles and
  three small helpers to it for another +1.28 KB (37.3 KB) and +0.86 KB
  (21.2 KB); see [Volume profiles](#size-and-limits).
- **The drawings cost 71.3 KB as unminified ESM and 52.4 KB as the minified
  UMD**, only when you import them. That is a large number next to a 20 KB core,
  and it is the honest one: nine tools, a snap pipeline, a state machine, an
  undo history, a motion system and a schema loader are not small. `createDrawings`
  with the tools you name lets a bundler drop the ones you do not.

---

## Volume profiles

A volume profile is a horizontal histogram of how much volume traded at each
price, usually one per session, drawn against the price axis and marked with
the **point of control** (POC, the busiest price) and the **value area** (VAH
to VAL, the band around the POC that holds 70% of the session's volume). They
are a separate entry, `emberwick/profiles`, so a chart that never imports it
carries none of the code.

**Emberwick draws the profiles you give it. It never computes one from the
chart's bars.** The bars on a chart are often 5-minute bars or longer, and for
some instruments (an index) they carry no real volume at all; a profile binned
from them would look plausible and be wrong, and the library has no way to
know. A host computes profiles where the fine data lives, typically on a server
from 1-minute bars or ticks, and hands Emberwick the result in a small
versioned contract. Data in, pixels out.

### Enabling

```js
import { createChart } from 'emberwick'
import { createVolumeProfile } from 'emberwick/profiles'

const chart = createChart(el)
const profile = createVolumeProfile(chart, { data, mode: 'both' })

profile.on('hover', (bin) => showReadout(bin))   // null when the pointer is over no bin
profile.destroy()                                // detach; idempotent
```

The profile is a plugin on the [`below` layer](#plugins-experimental): it is
painted **under** the candles, over the grid, and clipped to the price pane
above the volume strip, so it never covers price action, an oscillator pane or
the strip's own bars. It claims no gesture. Pan, zoom, drawings, markers and
the crosshair behave exactly as they do without it, and a marker over a profile
bin is still hovered and clicked.

### The data contract

```ts
interface ProfileData {
  version: 1
  source?: string            // shown in the caption: "Vol: <source>"
  step: number               // price width of ONE bin; the same for every session (> 0)
  sessions: ProfileSession[] // any order; may be empty
}
interface ProfileSession {
  start: number              // ms since epoch: open time of the session's first bar
  end: number                // ms since epoch: open time of its last bar (inclusive)
  lo: number                 // price of the LOW edge of bin 0
  bins: number[]             // volume per bin, lowest price first; zeros allowed
  poc?: number               // price; computed when absent
  vah?: number               // value-area high, a bin's HIGH edge; computed with val when either is absent
  val?: number               // value-area low, a bin's LOW edge
  total?: number             // sum of bins; computed when absent
  developing?: boolean       // live: this session is still forming
}
```

Bin `i` covers `[lo + i*step, lo + (i+1)*step)`. **Times are milliseconds**, on
the same clock as `Bar.time`, and need not fall on a chart bar: a session
computed from 1-minute data may end at the open of its last minute, four
minutes into the chart's last 5-minute bar, and is drawn there.

- **What throws**, from `createVolumeProfile`, `setData` and `upsertSession`,
  with the session's index in the message: a `step` of 0 or less, `bins` that
  is not an array, a `start` after its `end` (or either not a time), and a `lo`
  that is not a price. A throw leaves the previous data in place. Nothing
  throws from a frame.
- **What is repaired.** A bin that is not a positive finite number counts as
  zero. `bins` is copied, so you may keep mutating your own array.
- **What is skipped, silently.** A session that does not overlap the loaded
  bars. On a live chart that has scrolled its history away that is the normal
  case, and it is drawn again when the bars are loaded.
- **What is computed.** A missing `poc`, value area or `total`, once, when the
  data arrives, by [`computeValueArea`](#computevaluearea).
- `null` and an empty `sessions` draw nothing. A `version` this build does not
  read draws nothing and warns once.

### Options

```js
createVolumeProfile(chart, {
  data,                      // ProfileData, or null
  mode: 'session',           // 'session' | 'visible' | 'both'
  width: 0.3,                // the longest bar, as a share: see below
  side: 'right',             // 'left' | 'right': where the visible profile sits
  valueArea: true,           // tint value-area bins, draw VAH and VAL
  poc: true,                 // draw the POC line
  extendPoc: false,          // carry each POC right until price trades through it
  tags: true,                // POC/VAH/VAL tags on the price axis
  label: true,               // the "Vol: <source>" caption
  hideFutureInReplay: true,  // under replay, hide sessions that have not finished
  colors: undefined,         // Partial<ProfileColors>; see "Colours"
})
```

| Method | Does |
|---|---|
| `setData(data)` | Replace every session. `null` draws nothing |
| `upsertSession(session)` | Add one session, or replace the one with the same `start`. Needs `setData` first: the bin `step` belongs to the data |
| `setOptions(partial)` | Change any option except `data`. Validated before anything is applied |
| `on('hover', fn)` / `off('hover', fn)` | The bin under the pointer; see below |
| `destroy()` | Detach from the chart. Idempotent, and safe after `chart.destroy()` |

Every method but `destroy` returns the controller.

**Modes.**

- `'session'` draws one profile per session. A session spans from half a bar
  before its first bar to half a bar after its last. Bars grow rightward from
  its left edge, and the longest is `width` of **that session's** pixel span,
  so every session is scaled within itself: a quiet session is as legible as a
  busy one.
- `'visible'` draws one profile at the `side` of the price pane: the bin-by-bin
  sum of every session that overlaps the bars on screen. Its longest bar is
  `width` of the pane's width, and its POC, VAH and VAL run the width of the
  pane.
- `'both'` draws the session profiles, then the visible one on top.

The visible profile **sums whole sessions**: a session half on screen
contributes all of its volume, because the contract carries a total per bin and
not a bin per bar. It is re-summed only when the set of sessions on screen
changes, or the data does; a zoom, a pan within the same sessions or a
price-scale ease only re-projects it.

**Bins are fixed in price.** Each bin edge is a price from your data, sent
through the price scale on every frame. Nothing is binned in pixel rows, which
would re-bin and shimmer every time the axis eased. Edges are rounded to the
pixel grid so neighbouring bins neither overlap nor gap, and bins shorter than
a pixel are merged into one rect per row, as long as the longest of them, so a
profile zoomed far out keeps its outline rather than turning to mush.

**`extendPoc`** carries each session's POC to the right, as a thinner line,
until the first later bar whose range contains it, or to the edge of the pane:
a "naked" POC. **`tags`** draws the POC, VAH and VAL of the *latest* session
(the developing one, on a live chart) as price-axis tags, and the visible
profile's when there is one.

### Live: the developing session

Send the forming session again whenever it changes. `upsertSession` replaces
by `start`, re-reads only that session and repaints only the profile layer:

```js
profile.setData({ version: 1, step: 0.05, source: 'futures volume', sessions: history })

everyMinute(() => {
  profile.upsertSession({
    start: todayOpen,        // the same start every time: that is the session's identity
    end: lastMinuteOpen,
    lo, bins,
    developing: true,
  })
})
```

A developing session whose `end` runs a minute or two past the chart's newest
bar is drawn up to that bar.

### Replay

Under [replay](#replay) a whole-session profile would show how a day traded
before the day has been played. With `hideFutureInReplay` (the default) a
session stays hidden until the last **revealed** bar has closed past its
`end`, and appears on the step that finishes it. The visible profile sums only
the sessions shown, the tags follow the latest finished session, and an
extended POC ends only at a bar that has been revealed. Seeking never
re-resolves anything: sessions are resolved against the whole replay dataset.
Set `hideFutureInReplay: false` to draw every session throughout.

### Hover

```js
profile.on('hover', (bin) => {
  // { session, price, binLow, binHigh, volume, pct, inValueArea }, or null
})
```

It fires when the bin under the pointer changes, and `null` once when the
pointer leaves a drawn bar. `session` is **your own** session object, or `null`
for the visible profile; `pct` is the bin's share of its profile's total
volume, 0 to 100. The hovered bin is highlighted on screen and left out of
`toImage()`. Hover is mouse and pen only, and it never changes the cursor or
the crosshair. When the view or the data moves under a still pointer the bin is
re-tested, so the readout never goes stale.

### Colours

The colours derive from the chart theme, so `setTheme(lightTheme)` gives a
legible profile with no further work: a light neutral on a dark background and
a dark one on a light background, at a low alpha for bins and a stronger one
for the value area; a warm orange POC; and the theme's `text` colour for VAH
and VAL. Four optional theme keys override them, and the `colors` option
overrides the theme:

| `colors` key | Theme key | Colours |
|---|---|---|
| `fill` | `profileFill` | Bins outside the value area |
| `valueArea` | `profileValueArea` | Bins inside it |
| `poc` | `profilePoc` | The POC line and its tag |
| `vaLine` | `profileVaLine` | VAH and VAL lines and their tags |
| `hover` | — | The bin under the pointer |

Use `rgba()` for the two fills: the candles are drawn over them.

### `computeValueArea`

```js
import { computeValueArea } from 'emberwick/profiles'

computeValueArea([1, 4, 9, 5, 1], 100, 0.5)   // bins, lo, step, share = 0.7
// { poc: 101.25, vah: 102.5, val: 101 }       null when nothing traded
```

The function Emberwick uses when your data omits the POC or the value area. It
is pure and imports with no DOM, so a server can check its own numbers against
it. The POC is the busiest bin's centre; a tie goes to the bin nearest the
middle, then the lower one. The value area is the standard one: start at the
POC, compare the **two** bins above with the two below, add the larger pair,
and stop at 70% of the total. A pair is added whole, two equal pairs resolve to
the upper one, and at an edge the area grows the other way.

### Size and limits

Measured by `npm run size`, gzipped: **9.7 KB** as unminified ESM and
**6.2 KB** as the minified UMD, and only when you import it. The four
core additions it stands on (the `below` plugin layer, `timeToIndex` and
`indexToTime`, `host.drawPriceTag` and `isLight`) cost every chart
**+0.86 KB** in the minified core UMD and +1.28 KB in the
unminified ESM, and CI fails the build if that passes +1.5 KB.

- **The visible profile sums whole sessions**, as above.
- **Bins behind the volume strip are clipped.** The strip takes the bottom
  `volumeRatio` of the price pane, and the lowest prices of an autoscaled view
  fall behind it. On a chart whose visible bars carry no volume there is no
  strip and nothing is clipped.
- **A session wider than the screen shows its lines, not its bins**, when its
  left edge is off screen: the bars grow from that edge.
- **Profiles do not influence autoscale**, and a POC outside the visible
  prices is simply off screen.
- **Tags are painted under the candles' own tags** (last price, price lines),
  because the profile is on the layer below them.

---

## Plugins (experimental)

Drawings are built on a small, generic seam that is public. **It is
experimental and may change before 1.0**, and it is typed `@experimental` in
`index.d.ts`. It exists because gesture state in the chart lives in closure
locals, so nothing outside could take part in a press correctly; the
alternatives were worse (drawing on `overlay`, which the crosshair clears on
every pointer move; drawing on `main`, which would repaint every candle for a
line drag; monkey-patching the handlers; a canvas per plugin at about 7 MB
each at 900×500 and a pixel ratio of 2).

```js
const plugin = {
  attach(host) { this.host = host },
  draw(ctx, info) { /* paint on the plugins canvas */ },
  pointerDown(e) { return true },   // true: this plugin owns the gesture
}
chart.addPlugin(plugin)             // idempotent per object
chart.removePlugin(plugin)
```

A plugin paints **above** the candles unless it says otherwise. Set
`layer: 'below'` on the plugin object to paint **under** them instead, which is
where context behind price belongs (a volume profile, a session shade): drawn
over the candles it would hide the price action. `layer` is read once, by
`addPlugin`.

```js
chart.addPlugin({
  layer: 'below',                   // 'above' is the default
  draw(ctx) { /* painted under the candles, over the grid */ },
})
```

Every hook is optional, and `this` is the plugin:

| Hook | Called | Notes |
|---|---|---|
| `attach(host)` / `detach()` | On add / remove (and chart `destroy()`) | |
| `tick(dt, info)` | Every frame while attached | Advance your own state. `info.full` means the view moved or everything was invalidated: re-derive held points there. Return `true` to keep the loop awake **without** repainting the candles |
| `draw(ctx, info)` | When this plugin's layer repaints | The context is cleared, pixel-ratio scaled and `save`/`restore`-wrapped. `info.exporting` is true during `toImage()` |
| `afterFrame()` | After the chart's own state events | The safe place to emit to your listeners |
| `hover(e, reason)` | A mouse or pen moved | Return `{ cursor, crosshair }`. `e === null` says why: the pointer left, a pan press began, or a plugin above reported a hit |
| `pointerDown(e)` | A press | Return `true` to own it until up, cancel or `host.release()` |
| `pointerMove(e)` / `pointerUp(e)` | For the owner's own pointer | `pointerUp` runs synchronously inside the DOM event, so `focus()` works there on iOS |
| `pointerCancel()` | A second finger, a browser cancel, a lost capture, a context menu mid-gesture, a new press while still owning, removal | Every claimed press ends exactly once |
| `tap(e)` | An unclaimed primary press that never left the slop | `true` consumes it |
| `doubleClick(e)` / `contextMenu(e)` / `keyDown(e)` | | `true` consumes: no view reset, no browser menu, no pan or zoom key |

Input is offered to plugins first, topmost first, and the first to return
`true` wins. Every plugin above the candles is asked before any plugin below
them, whatever order they were attached in, so a `below` plugin that claims
nothing blocks nothing. `PluginPointer` carries the position in chart pixels, the pointer
type, modifiers, the `region` (`'plot' | 'priceAxis' | 'timeAxis'`, the chart's
own test, so you agree with its gestures) and the pane under it.

`host` is one object per attachment, all getters, so every read is live:
`chart`, `ts`, `bars` (under replay, the revealed prefix), `source` (the whole
replay dataset: **resolve anchors against this**), `replay`, `timeframeMs`,
`barGen`, `panes`, `theme`, `fmt`, `width`, `height`, `pixelRatio`,
`plotBottom`, `magnet`, `volumeRatio`, `priceLines`, `animate` and `exporting`;
and the methods `invalidate()`, `setCursor(css)`, `setHover(css)`,
`setCrosshair(point)`, `release()`, `paneAt(y)`, `paneById(id)`,
`timeToIndex(time)`, `indexToTime(index)`, `formatPrice(price, pane?)`,
`drawPriceTag(ctx, price, opts?)` and `reportError(err, phase)`. Plugins must
not read `_`-prefixed chart members; everything they need is here or public on
`host.chart`. The `panes` are the chart's live pane objects, so `visible` is
rebuilt every frame: do not keep it.

`timeToIndex` gives the **fractional** bar index of a time in ms, resolved
against `source`: exact on a bar, linear across a session gap, extrapolated
past either end, so `host.ts.x(host.timeToIndex(t))` is where that moment is
drawn. The same pair is exported from the core as pure functions,
`timeToIndex(bars, time, timeframeMs)` and `indexToTime(bars, index,
timeframeMs)`.

`drawPriceTag(ctx, price, { color, textColor, pane, text })` draws the
price-axis gutter tag that a core price line draws, from the same code, so a
plugin's level and a price line's are the same object on the axis. The text
defaults to `formatPrice(price, pane)`, the fill to `theme.textStrong`, and a
price outside the pane draws nothing. Call it from `draw` with the context you
were given. The tag lands on your own layer: the crosshair's tag always covers
it, and a `below` plugin's tag also sits under the last-price tag and under
price-line tags, which are drawn with the candles.

**Layer order.** Attaching the first plugin creates a fourth canvas, and the
stack becomes `base`, `main`, **`plugins`**, `overlay`, which moves the
overlay's `z-index` from 3 to 4 (it matters only if you stack your own
elements inside the container). It is dropped with the last plugin, so a chart
without one is exactly what it was.

The first `layer: 'below'` plugin creates **`pluginsBelow`** instead, between
`base` and `main`, and the full stack is `base`, `pluginsBelow`, `main`,
`plugins`, `overlay`. Each canvas exists only while a plugin paints on it, and
only canvases that exist are numbered: a chart with one `below` plugin has four
canvases, not five, and a chart with none has the stack, the z-indexes and the
draw operations it had before the layer existed.

Markers are drawn on `main`, so they sit above a `below` plugin. What such a
plugin reports from `hover` therefore never hides a marker: the marker's hover
and its `pointer` cursor win where the two overlap.

**Dirty and keep-alive rules.** `host.invalidate()` repaints the layer that
plugin lives on next frame, and neither the candles nor the other plugin layer.
`tick` returning `true` keeps the loop running and repaints that plugin's layer
only; returning nothing lets an idle chart drop to zero CPU. A plugin that
animates must say so or it stops.

**Errors are isolated.** A hook that throws is reported through the chart's
`'error'` event with the phase `plugin <hook>` and reads as "not claimed". A
plugin whose frame hooks fail ten painted frames in a row is removed, which is
the same budget the render loop has. A throwing listener of your own `'error'`
handler is not isolated from inside a frame.

**Exporting.** With a plugin attached, `toImage()` first re-renders every layer
from the current state, then calls your `draw` on the composite canvas with
`info.exporting` set, at the depth your layer has on screen: the image is
`base`, the `below` plugins, `main`, the other plugins, then `overlay`. That
re-render runs `tick` and `afterFrame` once, so state events can fire from
inside `toImage()`.

**Reserved and not built:** a `beforeFrame(dt)` hook (edge auto-pan would need
it) and an autoscale `extent()` hook.

---

## Time zones

Axis labels and the crosshair read in the browser's local zone by default.
Pass a zone when the instrument's session is defined somewhere else:

```js
const chart = createChart(el, { timeZone: 'Asia/Kolkata' })
chart.setTimeZone('UTC')   // or change it later
```

An NSE chart then opens at 09:15 whoever is reading it. This is **display
only** — bar times, the crosshair payload, `visibleRange()` and marker times
stay in the ms epochs you supplied.

The first label of each new day shows the date rather than the time, in the
same zone. Without that, a multi-day intraday chart is a wall of times with no
indication of where one session ends — a day boundary is only midnight for
instruments that trade through it, which intraday ones do not.

---

## Fitting the view

```js
chart.setData(bars)
chart.fitContent()
```

The opening move for a finished dataset — a backtest, a replay tape — where
the useful first view is the whole run rather than the last hundred bars at
the default zoom. It is deliberately **not** animated: easing 4,000 bars from
9px each down to 0.2 reads as a glitch, not as polish.

Fitting is allowed to zoom out past `timeScale.minSpacing` and lowers it to
match. That bound exists to stop a wheel gesture burying the chart in mush; an
explicit "show me everything" is a different intent, and clamping it would
both hide part of the dataset and make the next zoom-in jump back up to the
old floor.

### A window of it, instead

```js
chart.setData(bars)                            // all 29,105 of them
chart.setVisibleRange({ from: 0, to: 99 })     // open on the first hundred
```

For a run you mean to read **forward**. Fitting a finished backtest whole is
the honest view of the dataset and a useless first impression: 29,000 bars
across an 832px plot is 0.03px each, every series collapses onto every other,
and the trade markers thin to one per four pixels. The rest of the run stays
loaded and pannable — this is a view, not a filter.

Inclusive bar indices, `to` at the right edge. Ends outside the loaded data
clamp, a reversed pair is swapped, and a one-bar window widens to two; `false`
comes back only when there is no window to set at all — a destroyed chart,
fewer than two bars loaded, or ends that are not numbers. So a call that raced
the data load is loud rather than quietly showing some other window.

The chart stops following new bars unless `to` is the newest one. A window
pinned at the start of a live feed would otherwise be re-targeted by the very
next candle, which on a 29,000-bar set moves it thousands of bars on the first
frame.

Zooming *in* never reaches `minSpacing`, so unlike `fitContent()` this
normally leaves the interactive floor alone. A window **wider** than that
floor allows still lowers it, for the same reason fitContent does: clamping
would show a different window from the one you named and still report success.

There is one floor it will not go below, and one case it therefore cannot
honour exactly: a window needing less than 0.02px per bar — wider than about
41,600 bars on an 832px plot — is truncated from the left and still returns
`true`. `fitContent()` on a dataset that size does the same thing, and a
window that wide has nothing legible in it either way.

> Reading the window back is not the identity of setting it. `visibleRange()`
> reports every bar with any pixel on screen, so it answers a bar or two wider
> than the window you set — save what you *set*, not what you read.

---

## Interaction

| Input | Action |
|---|---|
| Drag in any pane | Pan, in both axes — time for every pane, price for the pane under the pointer (inertia on release is horizontal only) |
| Wheel | Zoom, anchored on the cursor |
| Two-finger pinch | Zoom |
| Drag price axis | Stretch the price scale of the pane beside the pointer |
| Drag time axis | Zoom the time scale |
| Double-click in a pane | Reset both: default zoom, every pane's scale back to autoscale, snap to realtime |
| Double-click an axis | Reset just that one — the price gutter returns its own pane to autoscale, the time axis resets the time scale |
| `←` / `→` | Pan (hold `Shift` for a bigger step) |
| `+` / `-` | Zoom |

The container gets `tabindex="0"` if it has none, so keyboard nav works
without extra markup.

When a [plugin](#plugins-experimental) is attached (drawings are one), it is
offered input first, and a few behaviours change with it:

- **Double-click, taps, context menus and keys are offered to plugins first.**
  A double-click that completes a plugin gesture (the second click of a
  click-click trend line) never also resets the view.
- **What counts as a tap.** A primary press that never travelled past the slop
  (3 px for mouse and pen, 10 px for touch) from where it went down, was not
  cancelled, was not a scrub and was not swallowed by a plugin. It is offered
  at the *down* point, in every region.
- **A third finger is ignored** during a pinch, and the finger left after a
  pinch keeps panning instead of drawing a stray crosshair.
- **A stuck press ends itself.** A mouse or pen move that reports no buttons
  held during a press, or a lost pointer capture, ends the press. (A press
  whose `pointerup` was swallowed, by a native context menu or a modal, used to
  keep panning on hover.)

### Touch

A finger cannot hover. On a mouse the crosshair tracks a pointer that is
merely *over* the chart and panning needs a button held, so the two gestures
never collide; on touch the only way to move the pointer at all is to be
touching, which is also the pan gesture. Emberwick separates them in time
instead:

| Gesture | Action |
|---|---|
| Tap | Place the crosshair there. It stays after the finger lifts |
| Long-press, then drag | Scrub — the crosshair follows the finger and the chart does not pan |
| Drag straight away | Pan, exactly as a mouse drag does. The crosshair is hidden for the gesture |
| Two-finger pinch | Zoom, and dismiss the crosshair |
| Two fingers, moving together | Pan as well as zoom, so a pinch that drifts moves the view instead of only scaling it |

With a drawing tool armed, one finger draws instead of panning and two fingers
pan; see [Drawing on a phone](#drawing-on-a-phone).

A crosshair placed by tap or long-press is *sticky*: it outlives the gesture,
because a reader who taps a bar wants to read it after lifting their finger.
Dismiss it with a pan, a pinch, or `chart.hideCrosshair()`.

```js
createChart(el, {
  touchCrosshair: true,      // default. false restores one-finger pan-and-track
  touchCrosshairDelay: 350,  // ms a finger must rest before a drag scrubs
})
```

Movement under 10px is treated as a tap rather than a pan, since a resting
finger drifts. A long press on the price or time gutter is still an axis
drag — the crosshair has nothing to say out there. Stylus input hovers, so
`pointerType: 'pen'` follows the mouse path, not this one.

---

## Theming

Pass any subset of the theme keys; the rest fall back to `defaultTheme`.

```js
import { defaultTheme, lightTheme } from 'emberwick'

chart.setTheme(lightTheme)
chart.setTheme({ up: '#00d68f', down: '#ff5c5c', background: '#0b0e14' })
```

Available keys: `background`, `grid`, `axisLine`, `text`, `textStrong`, `up`,
`down`, `upFill`, `downFill`, `wickUp`, `wickDown`, `volumeUp`, `volumeDown`,
`crosshair`, `labelBg`, `labelText`, `tagText`, `font`, `priceAxisWidth`,
`timeAxisHeight`.

Three optional keys feed the [drawing theme](#styling) and nothing in the core
reads them: `drawingAccent`, `drawingLine` and `drawingFib` (an array). Four
more feed [volume profiles](#colours) the same way: `profileFill`,
`profileValueArea`, `profilePoc` and `profileVaLine`.

---

## Framework integration

### React — the bundled adapter

```jsx
import { EmberwickChart } from 'emberwick/react'
import { RandomFeed } from 'emberwick'
import { useMemo, useRef } from 'react'

export function Chart() {
  // Memoise the feed — a new instance re-loads history.
  const feed = useMemo(() => new RandomFeed({ timeframe: 60_000, speed: 60 }), [])
  const ref = useRef(null)

  return (
    <div style={{ height: 480 }}>
      <EmberwickChart
        ref={ref}
        feed={feed}
        priceMode="linear"
        theme={{ up: '#00d68f' }}
        onCrosshair={(p) => p && console.log(p.bar)}
      />
      <button onClick={() => ref.current.chart.snapToRealtime()}>Realtime</button>
    </div>
  )
}
```

Props: `data`, `feed`, `options`, `theme`, `priceMode`, `animate`, `magnet`,
`onCrosshair`, `className`, `style`. Any other prop is spread onto the host
`<div>`. The ref exposes `{ chart }` for imperative calls.

The component creates the chart **once** and drives it through its methods on
prop changes — it never rebuilds the canvas, so pan/zoom position and animation
state survive re-renders. `data` is compared by **content**, not identity, so
passing an inline array literal is safe: an unchanged array is ignored, a moved
last bar is merged as a tick, and bars appended to the same history are
appended rather than re-anchoring the view. Only a genuinely different dataset
snaps back to the right edge.

`options` is read once, when the chart is created. Change `theme`, `priceMode`,
`animate` or `magnet` through their own props instead. `destroy()` runs on unmount, so React 18 StrictMode
double-mounting is safe.

### React — by hand

The adapter is ~100 lines of `useEffect`; doing it yourself is fine:

```jsx
import { useEffect, useRef } from 'react'
import { createChart, RandomFeed } from 'emberwick'

export function Chart() {
  const hostRef = useRef(null)

  useEffect(() => {
    const chart = createChart(hostRef.current)
    const feed = new RandomFeed({ timeframe: 60_000 })
    chart.setFeed(feed)
    return () => { feed.destroy(); chart.destroy() }
  }, [])

  return <div ref={hostRef} style={{ width: '100%', height: 480 }} />
}
```

### Web Component — works in any framework

```html
<script type="module">
  import 'emberwick/webcomponent'
  import { RandomFeed } from 'emberwick'

  const el = document.querySelector('emberwick-chart')
  el.feed = new RandomFeed({ timeframe: 60000, speed: 60 })
  el.addEventListener('crosshair', (e) => console.log(e.detail))
</script>

<emberwick-chart theme="dark" style="height: 480px"></emberwick-chart>
```

| | |
|---|---|
| Attributes | `theme="dark\|light"`, `animate="false"`, `magnet="false"` |
| Properties | `feed`, `data`, `chart` (read-only) |
| Events | `crosshair` — `event.detail` is the payload or `null` |

The element renders into a shadow root, so host-page CSS can't reposition the
stacked canvases. Assigning `feed`/`data` before the element upgrades is safe.
This is the path for Vue, Svelte, Angular or server-rendered templates without
a framework-specific wrapper.

### Vue 3

A chart is created once and driven imperatively — there is no Vue adapter
because there is nothing for one to do. `createChart()` in `onMounted`,
`destroy()` in `onBeforeUnmount`, and the instance is the API.

Store it in a plain variable or a `shallowRef`, never a `ref()`. A Chart
declares Vue's `__v_skip`, so Vue will not deep-proxy it even if it lands in
reactive state — but the **bar array you pass in** is still yours to protect.
Deep reactivity over tens of thousands of bars, on an object repainting at
60fps, is the one performance cliff worth knowing about here.

```vue
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { createChart, RandomFeed } from 'emberwick'

const host = ref(null)
let chart, feed

onMounted(() => {
  chart = createChart(host.value)
  feed = new RandomFeed({ timeframe: 60_000 })
  chart.setFeed(feed)
})
onBeforeUnmount(() => { feed?.destroy(); chart?.destroy() })
</script>

<template><div ref="host" style="width: 100%; height: 480px" /></template>
```

### Plain HTML

```html
<div id="chart" style="height: 480px"></div>
<script type="module">
  import { createChart, RandomFeed } from 'emberwick'
  const chart = createChart(document.getElementById('chart'))
  chart.setFeed(new RandomFeed({ timeframe: 60_000 }))
</script>
```

---

## `RandomFeed` — synthetic data for development

Bundled so you can build UI before your backend exists. It's an ordinary
`DataFeed` implementation with no special privileges.

```js
new RandomFeed({
  symbol: 'EMBR',
  timeframe: 60_000,
  seed: 7,              // deterministic: same seed → same chart
  start: 100,           // starting price
  volatility: 0.0022,
  drift: 0.00002,
  ticksPerSecond: 8,    // live update rate
  speed: 1,             // time multiplier; 60 = one candle per second
})
```

Runtime controls: `setSpeed(n)`, `setTicksPerSecond(n)`, `setPaused(bool)`,
`paused` (getter), `stop()`, `destroy()`.

Set `speed: 60` to see the flowing motion immediately instead of waiting a
minute per candle.

---

## Exports

```js
import {
  createChart, Chart,           // entry point
  DataFeed, RandomFeed,         // data layer
  defaultTheme, lightTheme,     // themes
  TimeScale, PriceScale,        // scales (advanced)
  Smoothed, Tween, Inertia,     // motion primitives
  LiveCandle,
  Replay, MIN_SPEED, MAX_SPEED, // bar-by-bar playback
  easeOutCubic, easeInOutCubic,
  mulberry32,                   // seeded PRNG
  toNumber, DASH,               // the coercion and dash arrays inputs share
  timeToIndex, indexToTime,     // time <-> fractional bar index
  isLight,                      // is this theme background light?
  version,
} from 'emberwick'

import {
  enableDrawings, createDrawings, STANDARD_TOOLS, TOOL_PRESETS,
  trendLine, horizontalLine, verticalLine, rectangle, parallelChannel,
  fibRetracement, measure, position, text,   // the nine tools
  normalizeDrawings,                         // pure, SSR-safe validation
  timeToIndex, indexToTime, SCHEMA_VERSION, version,
} from 'emberwick/drawings'

import {
  createVolumeProfile,                       // draw profiles you supply
  computeValueArea,                          // pure, SSR-safe POC and value area
  DATA_VERSION, version,
} from 'emberwick/profiles'
```

`toNumber` (numbers and numeric strings pass; `null`, booleans and `''` are
`NaN`, never `0`) and `DASH` are exported so a plugin coerces input and names a
dash the same way the core does: `'dashed'` then means one thing across price
lines, series and drawings.

`timeToIndex(bars, time, timeframeMs)` and `indexToTime(bars, index,
timeframeMs)` map a time in ms to a **fractional** bar index and back: exact on
a bar, linear across a gap, extrapolated past either end, and never clamped or
snapped the way a marker is. `emberwick/drawings` re-exports the same two
functions, as it always has.

`isLight(color)` is true when a colour's relative luminance is above 0.5. A
theme has no dark or light flag, so this is how a plugin that derives its own
colours picks a set that reads on `theme.background`. It parses `#rgb`,
`#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`; anything else reads as
dark.

---

## How the motion works

Four independent mechanisms, which is why it reads as smooth rather than
merely animated:

1. **Live candle** — each of O/H/L/C eases toward the incoming tick over
   ~55ms, with the wick clamped so it can't invert mid-chase. A brand new
   candle plays a short grow-from-centre animation as it scrolls in.
2. **Price axis** — autoscale bounds are smoothed, so a spike glides the axis
   instead of jolting it and losing the reader's place.
3. **Time axis** — `spacing` (zoom) and `right` (edge position) are smoothed,
   so wheel zoom eases and new bars slide in. **Dragging deliberately does
   not ease** — easing a drag feels like lag, not polish.

4. **Drawings** (only if you enable them) — a drawing's anchors never move by
   themselves; what glides is a *residual* kept in data space (bars, price)
   that decays to zero. Because it is in data units, a glide stays glued to the
   candles even if the view zooms mid-animation. The exception is the drag:
   a change of bar slot or magnet target is crisp, because a glide would trail
   the pointer, which is the same reason dragging the time axis does not ease.
   See [Motion](#motion) under Drawing tools.

All of it runs through `Smoothed`, a frame-rate-independent exponential
smoother: the same visual speed at 30fps and 144fps. The render loop returns
whether anything is still animating, so a static chart idles at zero CPU.

Rendering is split across three stacked canvases — `base` (grid + axes),
`main` (candles + volume), `overlay` (crosshair) — so moving the pointer
repaints only the crosshair, never the candles underneath. (Attaching a
plugin, drawings included, adds a fourth, `plugins`, between `main` and
`overlay`.) All contexts are
pre-scaled by `devicePixelRatio`, so drawing code works in CSS pixels and
output stays crisp on retina.

---

## Building the package

The repo is both the library and its playground. The playground is an ordinary
Vite app (`npm run dev` / `npm run build`); the library has its own builds.

```bash
npm run build:lib    # ESM, multi-entry  -> dist-lib/{index,react,webcomponent,drawings,profiles}.js
npm run build:umd    # minified UMD      -> dist-lib/umd/{emberwick,emberwick-drawings,emberwick-profiles}.umd.js
npm run pack:lib     # manifest + README + .d.ts into dist-lib/
npm run verify:package  # the assembled directory, checked as a consumer would use it
npm run size         # gzipped size budget check
npm run release      # test, then all of the above, in order
npm publish ./dist-lib   # publish the assembled directory — note the ./
```

> The leading `./` is required. `npm publish dist-lib` makes npm look for a
> *registry package* named `dist-lib` and fail with `E404`.

Publishing from `dist-lib/` keeps the playground, the build configs and the
app's private `package.json` out of the artifact. `package.lib.json` is the
manifest that becomes the published `package.json`.

Two guards keep the opt-in entries (drawings, profiles) from leaking into the
core, and the build is where they run. `verify:package` fails if `dist-lib/`
contains a `chunks/` folder, which is what Rollup does when two entries share a
deep import: an opt-in entry may import the core only through its public entry,
and must bind `version` from it, a value defined there, not a re-export. And CI
builds the core alone and compares it with the core from the full build:
`index.js` and its source map must be **byte-identical**. `npm test` carries
the source-level half of the same rules (`package-boundaries`: import
boundaries, no module-scope DOM access, nothing newer than ES2019 in
`src/drawings` and `src/profiles`, and nothing that ships importing the demo
site). `verify:package` also checks that neither entry carries the other's
code, and that none of the demo site's code is in any shipped file. `npm run
size` fails if the core grows more than 1.5 KB gzipped over the last release.

React is an **optional peer dependency**, external in every build — importing
`emberwick` never pulls React in.

Source layout:

```
src/chart/                  the library core (zero deps, no framework)
  core/      Chart, Layers, Loop, TimeScale, PriceScale, palette, formatters
  render/    grid, candles, crosshair, annotations
  motion/    Tween (Smoothed), Inertia, LiveCandle
  overlays/  annotations (normalise, resolve, collision layout)
  replay/    Replay (bar-by-bar playback)
  data/      DataFeed (the seam), RandomFeed
  index.js   public API surface   index.d.ts  types
src/drawings/               drawing tools (imports only ../chart/index.js)
  model/       schema and load report, time <-> fractional bar index, store, history
  tools/       the nine ToolDefs
  interaction/ hit-testing, snapping, the gesture state machine, keys, text editor
  render/      scene painter, motion, drawing theme, shared paint helpers
  Drawings.js  the controller (a chart plugin)   index.js  entry   index.d.ts  types
src/profiles/               volume profiles (imports only ../chart/index.js)
  data.js      the ProfileData contract: validation and one-time preparation
  valueArea.js computeValueArea: POC and the 70% value area
  render.js    geometry and the bin renderer   theme.js  colours from the chart theme
  VolumeProfile.js  the controller (a `below` plugin)   index.js  entry   index.d.ts  types
src/adapters/react/         <EmberwickChart /> + dataPlan (framework-agnostic)
src/adapters/webcomponent/  <emberwick-chart>
src/pages/, src/components/, src/App.jsx, src/styles.css   the demo site (not published)
test/                       node --test, no jsdom (not published)
```

---

## Known gaps

Honest list of what isn't there yet:

- **No OHLCV legend in the package.** `subscribe('crosshair', fn)` gives you
  the hovered bar and the pane it is in; rendering the readout is still yours
  to do.
- **Markers are not draggable.** They are hit-tested for hover and click, but
  there is no drag-to-move or editing interaction.
- **No indicator maths.** Emberwick draws the line you hand it — see
  [Series](#series) and [Panes](#panes) — but computing SMA/EMA/RSI/MACD is
  yours. (Drawing tools exist now; see [Drawing tools](#drawing-tools).)
- **Panes are not resizable or reorderable.** Heights come from `weight` and
  `minHeight` and are fixed at layout; there is no drag handle between bands,
  and no way to reweight or move a pane short of `removePane()` and adding it
  again — which drops every series routed to it.
- **Markers, price lines and zones live on the price pane.** They take a time
  and a price and draw against the candles; there is no `pane` option that
  would put a level at RSI 70. *Drawings* do take a `pane`, so a horizontal
  line at RSI 70 is a drawing on the `'rsi'` pane.
- **Candlesticks only, as a price type.** No Heikin-Ashi, and no area or
  baseline fills — a series is a stroked line.
- **No session awareness.** The time axis is indexed by bar, not by clock, so
  weekends and overnight closes collapse to an ordinary bar step — which is
  usually what you want. What is missing is the deliberate half: sessions are
  never collapsed *on purpose*, and there are no session bounds to fit or snap
  to. (Session boundaries are at least legible: the first axis label of each
  new day shows the date, in the configured zone.)
- **Volume profiles are drawn, not computed.** `emberwick/profiles` renders
  profiles you supply and will not bin one from the chart's bars; see
  [Volume profiles](#volume-profiles) for why, and its
  [limits](#size-and-limits) (the visible profile sums whole sessions; bins
  behind the volume strip are clipped; no autoscale).
- **Drawings: a minority of TradingView's tools.** No brush, callout,
  pitchfork, Gann, fib extension or time zones. Each is a new geometry for a
  minority of users, and the tool contract is the experimental part.
- **Drawings: single selection.** The API is plural (`selection`, `select(ids)`)
  so multi-select can arrive without a breaking change, but 0.12 holds one id.
- **Drawings: no edge auto-pan.** Dragging a point past the plot edge does not
  scroll the view. Held points are kept honest by re-deriving them every frame,
  which covers a live tape moving under a still mouse.
- **Drawings: no alerts.** `priceAt(id, time)` is the building block; the
  alerting is yours.
- **Drawings: no templates or favourites**, and text is plain: no rich text.
- **Drawings: colours do not animate.** They change instantly in every motion
  mode.
- **Drawings: future points are bar counts.** A point past the newest bar is
  "k bars after", so it cannot know a session calendar, and a weekend is one
  bar wide there as it is everywhere else on the axis.
- **Drawings are not keyed by symbol.** See the symbol-switch caveat under
  [Saving and loading](#saving-and-loading).
- **Drawings do not influence autoscale.** A line far outside the candles is
  off screen until you scroll the price axis to it.
- **Drawing angles are screen angles.** A 45° line is 45° at the zoom it was
  drawn at, and is a different price-per-bar slope after a zoom.
- **`toImage()` omits selection chrome and includes a standing crosshair.**
  Committed drawings are exported at rest; handles, hover, previews and the
  axis bands are not. A crosshair a tap left standing still is (as before).
- **The plugin API is experimental**, and so is the `ToolDef` contract.
- **One-finger pan is off while a drawing tool is armed on touch.** Two fingers
  pan; disarm to pan with one.
- **Locked drawings are selected by a click or tap, never dragged**, and the
  chart pans through them.
- **On touch, a selected box moves by its border or its move handle, not its
  fill**, so a swipe over a box still pans.
- **Fills yield to markers.** A trade marker inside a position box or fib stays
  hoverable and clickable; strokes, handles and labels win over markers.
- **`RandomFeed` deep history is per-page coherent, not one continuous walk** —
  each page re-seeds from its own start time and opens near the feed's `start`
  price rather than at the neighbouring page's close, so paging far left can
  show a visible seam. Real feeds don't have this artifact.
- **Types are hand-written**, not generated from source, and nothing in CI
  checks them against the implementation — so they can drift.
- **No `require()`.** The manifest declares an `import` condition and no
  `require` one, so CommonJS gets `No "exports" main defined`. Use
  `await import('emberwick')`, or the UMD build — which is a real script-tag
  bundle, just not an import specifier. See [Installing](#installing).

---

## License

MIT
