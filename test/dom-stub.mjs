/**
 * The smallest DOM the Chart core actually touches, so the real modules can
 * run under plain `node --test` with no jsdom and no browser.
 *
 * Deliberately NOT a general DOM: requestAnimationFrame never fires on its
 * own, so no frame runs unless a test asks for one. Every assertion below is
 * about bar-array state, which the render path does not influence.
 */
const noop = () => {}

function makeCtx() {
  return new Proxy(
    { measureText: () => ({ width: 10 }), canvas: null },
    { get: (t, k) => (k in t ? t[k] : noop) }
  )
}

export function makeCanvas() {
  return {
    style: {},
    width: 0,
    height: 0,
    getContext: () => makeCtx(),
    remove: noop,
  }
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
  set('window', { devicePixelRatio: 1 })
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
