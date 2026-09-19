/**
 * The smallest DOM the Chart core actually touches, so the real modules can
 * run under plain `node --test` with no jsdom and no browser.
 *
 * Deliberately NOT a general DOM: requestAnimationFrame never fires on its
 * own, so no frame runs unless a test asks for one. Every assertion below is
 * about bar-array state, which the render path does not influence.
 */
const noop = () => {}

/**
 * A 2D context that records what was drawn.
 *
 * Canvas output is otherwise invisible to a test, which is why "does this
 * theme key do anything?" had no answer for twenty of them. Every method call
 * and every property assignment lands in `ops`, so a test can assert on the
 * fills and strokes a frame actually produced.
 */
function makeCtx(ops) {
  const base = { measureText: () => ({ width: 10 }), canvas: null }
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k]
      return (...args) => { ops.push({ op: k, args }); }
    },
    set(t, k, v) {
      ops.push({ op: 'set', prop: k, value: v })
      t[k] = v
      return true
    },
  })
}

export function makeCanvas() {
  const ops = []
  return {
    style: {},
    width: 0,
    height: 0,
    /** Everything drawn to this canvas, in order. */
    ops,
    getContext: () => makeCtx(ops),
    remove: noop,
  }
}

/** Values assigned to `prop` (e.g. 'fillStyle') on a chart layer this frame. */
export function drawnValues(chart, layer, prop) {
  const canvas = chart.layers.canvas[layer]
  return canvas.ops.filter((o) => o.op === 'set' && o.prop === prop).map((o) => o.value)
}

/** Clear the recorded ops on every layer — call before the frame you care about. */
export function clearOps(chart) {
  for (const name of chart.layers.names) chart.layers.canvas[name].ops.length = 0
}

export function makeContainer({ width = 900, height = 500 } = {}) {
  const attrs = new Map()
  return {
    style: {},
    children: [],
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    appendChild(c) { this.children.push(c) },
    addEventListener: noop,
    removeEventListener: noop,
    hasAttribute: (k) => attrs.has(k),
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k),
  }
}

/** Install globals. Returns a restore() that puts the environment back. */
export function installDom() {
  const saved = {}
  const set = (k, v) => { saved[k] = globalThis[k]; globalThis[k] = v }

  set('document', { createElement: () => makeCanvas() })
  set('getComputedStyle', () => ({ position: 'relative' }))
  set('ResizeObserver', class { observe() {} disconnect() {} })
  // A drivable matchMedia: `setDevicePixelRatio()` below fires the listeners
  // a real browser would fire when a window moves to a different-DPI monitor.
  const queries = new Set()
  set('window', {
    devicePixelRatio: 1,
    matchMedia: (query) => {
      const mq = {
        media: query,
        matches: true,
        _listeners: new Set(),
        addEventListener(_type, fn, opts) {
          mq._once = !!(opts && opts.once)
          mq._listeners.add(fn)
          queries.add(mq)
        },
        removeEventListener(_type, fn) {
          mq._listeners.delete(fn)
          queries.delete(mq)
        },
      }
      return mq
    },
  })
  globalThis.__dprQueries = queries
  // Never fires: tests drive state directly, so no frame can race an assert.
  set('requestAnimationFrame', () => 1)
  set('cancelAnimationFrame', noop)

  return () => { for (const k of Object.keys(saved)) globalThis[k] = saved[k] }
}

/**
 * Run one real frame.
 *
 * requestAnimationFrame deliberately never fires in this harness, so nothing
 * drives Chart._frame on its own — which meant marker resolution, price-scale
 * autoscale, the marker hit map and both state emissions went completely
 * unverified. Drive it explicitly instead: still deterministic, but the render
 * path actually executes.
 *
 * `dt` is the frame delta in ms (16 ≈ 60fps). Returns whatever _frame returns,
 * i.e. true while something is still animating.
 */
export function frame(chart, dt = 16, dirty = ['all']) {
  return chart._frame(new Set(dirty), dt)
}

/** Run frames until nothing is animating, or `max` is reached. Returns the count. */
export function settle(chart, max = 600, dt = 16) {
  let n = 0
  while (n < max && frame(chart, dt)) n++
  return n
}

/**
 * Change the device pixel ratio and notify anything watching for it, the way
 * dragging a window to a different-DPI monitor does.
 */
export function setDevicePixelRatio(dpr) {
  globalThis.window.devicePixelRatio = dpr
  for (const mq of [...(globalThis.__dprQueries || [])]) {
    mq.matches = false
    for (const fn of [...mq._listeners]) {
      if (mq._once) mq._listeners.delete(fn)
      fn({ matches: false, media: mq.media })
    }
    if (mq._once) globalThis.__dprQueries.delete(mq)
  }
}

/** Ascending, de-duplicated bars — the documented feed contract. */
export function makeBars(startMs, count, tfMs = 60_000, price = 100) {
  return Array.from({ length: count }, (_, i) => ({
    time: startMs + i * tfMs,
    open: price, high: price + 1, low: price - 1, close: price, volume: 10,
  }))
}

/** A feed whose getBars() resolves only when you tell it to. */
export function deferredFeed({ symbol, timeframe = 60_000 }) {
  const pending = []
  let handler = null
  let live = null
  return {
    symbol,
    timeframe,
    getBars: () => new Promise((resolve) => pending.push(resolve)),
    subscribe(fn) {
      handler = fn
      live = fn // kept past unsubscribe: a real socket keeps delivering
      return () => { handler = null }
    },
    /** Resolve the Nth outstanding getBars() call. */
    release(index, bars) { pending[index](bars) },
    get pendingCount() { return pending.length },
    /** Push a tick as the live subscription would. */
    tick(msg) { if (handler) handler(msg) },
    /**
     * Push a tick into the handler this feed installed, IGNORING unsubscribe —
     * models a socket that keeps delivering after the chart moved on.
     */
    forceTick(msg) { if (live) live(msg) },
    get subscribed() { return handler !== null },
  }
}
