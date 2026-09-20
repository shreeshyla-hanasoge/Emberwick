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

The UMD build is core-only and exposes the global `Emberwick`. It is for
`<script>` tags and CDNs only — there is deliberately no `emberwick/umd`
import specifier, because a UMD file loaded as an ES module exports nothing
and quietly assigns a global instead.

> **Emberwick is ESM-only.** `import` works everywhere; `require('emberwick')`
> does not, and Node reports that as `No "exports" main defined`. Use a dynamic
> `await import('emberwick')` from CommonJS, or the UMD build above.

### By vendoring the source

Nothing stops you copying the core in directly:

```bash
cp -r src/chart /path/to/your-project/src/emberwick
```

```js
import { createChart, RandomFeed } from './emberwick/index.js'
```

The folder is self-contained — `src/chart/` has no imports that point outside
itself, and no framework dependency. Anything that can bundle ES modules
(Vite, webpack, Rollup, esbuild, or a browser with native ESM) can consume it
as-is.

### Entry points

| Import | Contents |
|---|---|
| `emberwick` | The core: `createChart`, `Chart`, feeds, themes, motion primitives |
| `emberwick/react` | `<EmberwickChart />` React component |
| `emberwick/webcomponent` | Registers `<emberwick-chart>` (side-effecting import) |

TypeScript declarations ship for all three entries. The UMD build is not an
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
| `toImage()` | PNG data URL of the composited layers |
| `resize()` | Re-measure the container now. Resizes and pixel-ratio changes are automatic |
| `resume()` | Restart the render loop after it gave up. See below |
| `destroy()` | Remove listeners, stop the loop, drop canvases |
| `chart.fps` | Getter — measured frames per second |

### Events

```js
const off = chart.subscribe('crosshair', (payload) => {
  if (!payload) return           // pointer left the plot
  const { index, bar, price } = payload
  legend.textContent = `O ${bar.open} H ${bar.high} L ${bar.low} C ${bar.close}`
})
off()  // unsubscribe
```

| Event | Payload |
|---|---|
| `'crosshair'` | `{ index, bar, price }`, or `null` when the pointer leaves the plot |
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

## Interaction

| Input | Action |
|---|---|
| Drag in plot | Pan (with inertia on release) |
| Wheel | Zoom, anchored on the cursor |
| Two-finger pinch | Zoom |
| Drag price axis | Stretch the price scale |
| Drag time axis | Zoom the time scale |
| Double-click | Reset: default zoom, price scale back to autoscale, snap to realtime |
| `←` / `→` | Pan (hold `Shift` for a bigger step) |
| `+` / `-` | Zoom |

The container gets `tabindex="0"` if it has none, so keyboard nav works
without extra markup.

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
  version,
} from 'emberwick'
```

---

## How the motion works

Three independent mechanisms, which is why it reads as smooth rather than
merely animated:

1. **Live candle** — each of O/H/L/C eases toward the incoming tick over
   ~55ms, with the wick clamped so it can't invert mid-chase. A brand new
   candle plays a short grow-from-centre animation as it scrolls in.
2. **Price axis** — autoscale bounds are smoothed, so a spike glides the axis
   instead of jolting it and losing the reader's place.
3. **Time axis** — `spacing` (zoom) and `right` (edge position) are smoothed,
   so wheel zoom eases and new bars slide in. **Dragging deliberately does
   not ease** — easing a drag feels like lag, not polish.

All of it runs through `Smoothed`, a frame-rate-independent exponential
smoother: the same visual speed at 30fps and 144fps. The render loop returns
whether anything is still animating, so a static chart idles at zero CPU.

Rendering is split across three stacked canvases — `base` (grid + axes),
`main` (candles + volume), `overlay` (crosshair) — so moving the pointer
repaints only the crosshair, never the candles underneath. All contexts are
pre-scaled by `devicePixelRatio`, so drawing code works in CSS pixels and
output stays crisp on retina.

---

## Building the package

The repo is both the library and its playground. The playground is an ordinary
Vite app (`npm run dev` / `npm run build`); the library has its own builds.

```bash
npm run build:lib    # ESM, multi-entry  -> dist-lib/{index,react,webcomponent}.js
npm run build:umd    # minified UMD      -> dist-lib/umd/emberwick.umd.js
npm run pack:lib     # manifest + README + .d.ts into dist-lib/
npm run size         # gzipped size budget check
npm run release      # all four, in order
npm publish ./dist-lib   # publish the assembled directory — note the ./
```

> The leading `./` is required. `npm publish dist-lib` makes npm look for a
> *registry package* named `dist-lib` and fail with `E404`.

Publishing from `dist-lib/` keeps the playground, the build configs and the
app's private `package.json` out of the artifact. `package.lib.json` is the
manifest that becomes the published `package.json`.

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
src/adapters/react/         <EmberwickChart /> + dataPlan (framework-agnostic)
src/adapters/webcomponent/  <emberwick-chart>
src/pages/, src/App.jsx, src/styles.css   the playground (not published)
test/                       node --test, no jsdom (not published)
```

---

## Known gaps

Honest list of what isn't there yet:

- **No OHLCV legend in the package.** `subscribe('crosshair', fn)` gives you
  the hovered bar; rendering the readout is still yours to do.
- **Markers are not draggable.** They are hit-tested for hover and click, but
  there is no drag-to-move or editing interaction.
- **No indicators or drawing tools.** SMA/EMA/RSI/MACD, multi-pane layout and
  trendlines are planned but not implemented.
- **Candlesticks only.** No Heikin-Ashi, line, area or baseline series yet.
- **No session awareness.** The time axis is indexed by bar, not by clock, so
  weekends and overnight closes collapse to an ordinary bar step — which is
  usually what you want. What is missing is the other half: nothing marks
  where one session ends and the next begins, because a day boundary is only
  labelled at local midnight and intraday sessions rarely open there.
- **No timezone control.** Axis and crosshair times are formatted in the
  browser's local zone, with no `timeFormatter` or `timeZone` option. If your
  timestamps encode exchange-local wall time rather than true epochs, they
  will render shifted.
- **`RandomFeed` deep history is per-page coherent, not one continuous walk** —
  it regenerates backwards from a seed offset, so paging far left can show a
  visible seam. Real feeds don't have this artifact.
- **Types are hand-written**, not generated from source, so they can drift
  from the implementation.
- **ESM only.** No CommonJS build; `require()` will not resolve the package.

---

## License

MIT
