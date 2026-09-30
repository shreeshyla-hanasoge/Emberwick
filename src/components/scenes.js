/**
 * Drawings worth showing off, found IN whatever bars are loaded.
 *
 * The landing page's tapes are random walks that begin at the moment the page
 * opens, so no drawing can be hard-coded: a price written down in advance lands
 * in empty space. This picks a trend line, a fibonacci leg and a long position
 * from the bars themselves, and does it with the taste of a person drawing on a
 * real chart rather than the first two points that happen to be lowest:
 *
 *  - the fib goes over the largest single leg in the first 58% of the
 *    window, so there is chart to the right of it for the rest to sit on;
 *  - the trend line is a line the market actually respects: it joins two swing
 *    lows (or two swing highs) and no bar between them goes through it;
 *  - the position's target is one the tape really reaches before it touches the
 *    stop, so its label reads "Target hit" and not "Open".
 *
 * Nothing here is library API. It returns rows in the public `{ time, price }`
 * shape, and they go in through `add()` / `setDrawings()` like any document.
 * Each of the three is null when the bars will not give an honest one.
 */

const px = (v) => Number(v.toFixed(2))

/** A swing low (key 'low', dir -1) or high (key 'high', dir 1) with `k` bars of lower/higher either side. */
function isSwing(bars, i, key, dir, k) {
  const v = bars[i][key]
  for (let j = 1; j <= k; j++) {
    const a = bars[i - j]
    const b = bars[i + j]
    if (!a || !b) return false
    if (dir < 0 ? !(v < a[key] && v <= b[key]) : !(v > a[key] && v >= b[key])) return false
  }
  return true
}

/** The largest rise (low then high) and fall (high then low) with j after i, inside [lo, hi]. */
function biggestLeg(bars, lo, hi, minBars) {
  let up = null
  let down = null
  for (let i = lo; i <= hi - minBars; i++) {
    for (let j = i + minBars; j <= hi; j++) {
      const rise = bars[j].high - bars[i].low
      if (!up || rise > up.size) up = { i, j, size: rise }
      const fall = bars[i].high - bars[j].low
      if (!down || fall > down.size) down = { i, j, size: fall }
    }
  }
  return { up, down }
}

/**
 * The best line through two swing points that the bars respect.
 *
 * Support joins two rising swing lows, resistance two falling swing highs, and
 * a candidate only counts when no bar between its two points closes it on the
 * wrong side by more than `tol`. Longer wins (a longer line is a better
 * line), and every bar after the second point that goes through it costs
 * three bars of length, so the ray that extends right is one the market has
 * not already run over. Returns { a, b, key } or null.
 */
function respectedLine(bars, lo, hi, range) {
  // first the strict reading (five-bar swings, a tight tolerance), then a looser one
  for (const [k, tol] of [[2, 0.02], [1, 0.035]]) {
    const found = respectedLineAt(bars, lo, hi, k, range * tol)
    if (found) return found
  }
  return null
}

function respectedLineAt(bars, lo, hi, k, tol) {
  let best = null
  const n = bars.length
  for (const [key, dir] of [['low', -1], ['high', 1]]) {
    const pts = []
    for (let i = Math.max(lo, k); i <= Math.min(hi, n - 1 - k); i++) if (isSwing(bars, i, key, dir, k)) pts.push(i)
    for (let x = 0; x < pts.length; x++) {
      for (let y = x + 1; y < pts.length; y++) {
        const a = pts[x]
        const b = pts[y]
        if (b - a < 6) continue
        // support rises, resistance falls
        if (dir < 0 ? !(bars[b][key] > bars[a][key]) : !(bars[b][key] < bars[a][key])) continue
        const slope = (bars[b][key] - bars[a][key]) / (b - a)
        let ok = true
        for (let i = a; i <= b && ok; i++) {
          const line = bars[a][key] + slope * (i - a)
          if ((dir < 0 ? line - bars[i].low : bars[i].high - line) > tol) ok = false
        }
        if (!ok) continue
        let over = 0
        for (let i = b + 1; i < n; i++) {
          const line = bars[a][key] + slope * (i - a)
          if ((dir < 0 ? line - bars[i].low : bars[i].high - line) > tol) over++
        }
        const score = b - a - 3 * over
        if (!best || score > best.score) best = { a, b, key, score }
      }
    }
  }
  return best && best.score > 4 ? best : null
}

const argmax = (bars, from, to, key) => {
  let at = from
  for (let i = from + 1; i <= to; i++) if (bars[i][key] > bars[at][key]) at = i
  return at
}

/** The first entry bar whose 0.7x-of-the-move target is reached before its 0.35x stop, or null. */
function findWinner(bars, lo, hi, horizon) {
  const n = bars.length
  for (let e = lo; e <= hi && e < n - 3; e++) {
    const end = Math.min(n - 1, e + horizon)
    const entry = bars[e].close
    const gain = bars[argmax(bars, e + 1, end, 'high')].high - entry
    if (!(gain > 0)) continue
    const target = entry + gain * 0.7
    const stop = entry - gain * 0.35
    let hit = -1
    for (let i = e + 1; i <= end; i++) {
      if (bars[i].low <= stop) break
      if (bars[i].high >= target) { hit = i; break }
    }
    if (hit > 0) return { e, end: Math.min(end, hit + 5), entry, target, stop }
  }
  return null
}

/**
 * @param {Array} bars   ascending Bar[]
 * @param {{ window?: number }} [want]  how many of the newest bars to spread
 *   the drawings over (default 80)
 * @returns {{ trend: object|null, fib: object|null, long: object|null,
 *             leg: 'up'|'down'|null }}  DrawingInput rows, ids fixed
 */
export function pickScenes(bars, want = {}) {
  const none = { trend: null, fib: null, long: null, leg: null }
  const n = bars ? bars.length : 0
  if (n < 40) return none
  const W = Math.min(n, Math.max(30, Math.floor(want.window) || 80))
  const base = n - W
  const at = (f) => base + Math.floor(W * f)

  const { up, down } = biggestLeg(bars, base + 2, at(0.58), Math.max(5, Math.floor(W * 0.12)))
  // the bigger leg wins, a rise on a tie: a long reads naturally after one
  const leg = up && (!down || up.size >= down.size) ? { ...up, dir: 1 } : down ? { ...down, dir: -1 } : null
  if (!leg) return none

  const a = leg.dir > 0 ? bars[leg.i].low : bars[leg.i].high
  const b = leg.dir > 0 ? bars[leg.j].high : bars[leg.j].low
  const fib = {
    id: 'show-fib',
    type: 'fibRetracement',
    points: [
      { time: bars[leg.i].time, price: px(a) },
      { time: bars[leg.j].time, price: px(b) },
    ],
    meta: { scene: true },
  }

  let lo = Infinity
  let hi = -Infinity
  for (let i = base; i < n; i++) {
    if (bars[i].low < lo) lo = bars[i].low
    if (bars[i].high > hi) hi = bars[i].high
  }
  const line = respectedLine(bars, base, Math.min(n - 3, at(0.8)), hi - lo)
  const trend = line
    ? {
        id: 'show-trend',
        type: 'trendLine',
        points: [
          { time: bars[line.a].time, price: px(bars[line.a][line.key]) },
          { time: bars[line.b].time, price: px(bars[line.b][line.key]) },
        ],
        options: { extend: 'right' },
        meta: { scene: true },
      }
    : null

  // after the leg, and toward the right of the window when it can be: a
  // position sat on top of the fib's last bar reads as one drawing, not two
  const w =
    findWinner(bars, Math.min(n - 8, Math.max(leg.j + 1, at(0.58))), n - 6, 34) ||
    findWinner(bars, Math.min(n - 8, leg.j + 1), n - 6, 34)
  const long = w
    ? {
        id: 'show-long',
        type: 'position',
        points: [
          { time: bars[w.e].time, price: px(w.entry) },
          { time: bars[w.end].time, price: px(w.target) },
          { time: bars[w.end].time, price: px(w.stop) },
        ],
        options: { side: 'long' },
        meta: { scene: true },
      }
    : null

  return { trend, fib, long, leg: leg.dir > 0 ? 'up' : 'down' }
}

/** Reward over risk of a position row, the way its own label reads it; null for a stop on the wrong side. */
export function riskReward(d) {
  const [entry, target, stop] = d.points.map((p) => p.price)
  const risk = d.options && d.options.side === 'short' ? stop - entry : entry - stop
  const reward = d.options && d.options.side === 'short' ? entry - target : target - entry
  return risk > 0 && reward > 0 ? reward / risk : null
}
