/**
 * Demo code: a synthetic market, one minute at a time.
 *
 * The landing page's profile demo needs what a real host has and a random
 * walk does not: sessions with an open and a close, volume that is heavy at
 * both ends of the day, and prices the market keeps coming back to, because
 * those are what give a volume profile a point of control and a value area
 * worth looking at. This makes that tape, deterministically from a seed, and
 * keeps making it: `next()` is the live feed.
 *
 * It is not a market model and is not in the library. See profileData.js for
 * why the demo keeps 1-minute bars at all.
 */
import { mulberry32 } from '../chart/index.js'

const MIN = 60_000

/** Minutes in one session: 09:30 to 16:00. */
export const SESSION_MINUTES = 390

/** Local 09:30 on the `day`-th weekday-agnostic day from a fixed date, so every visitor's axis reads 09:30. */
export const sessionOpen = (day) => new Date(2026, 8, 21 + day, 9, 30).getTime()

/** The session a time belongs to: its open. */
export const sessionOf = (time) => {
  const d = new Date(time)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 30).getTime()
}

/**
 * @param {object} [o]
 * @param {number} [o.seed]
 * @param {number} [o.start] opening price of the first session
 * @returns {{ next(): object, day: number, minute: number }} `next()` returns
 *   the next 1-minute bar, rolling into the next session after the close.
 */
export function createTape({ seed = 1309, start = 184 } = {}) {
  const rnd = mulberry32(seed)
  // Box-Muller, one draw per call: enough for a tape nobody trades.
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
  const tape = { day: 0, minute: 0 }
  let price = start
  let level = start        // the price the session is currently drawn to
  let moveAt = 0           // the minute it next picks a new one

  const openSession = () => {
    // A gap from yesterday's close, and a first level near the open.
    price = +(price * (1 + gauss() * 0.0022)).toFixed(2)
    level = price * (1 + gauss() * 0.0015)
    moveAt = 45 + Math.floor(rnd() * 70)
  }
  openSession()

  tape.next = () => {
    if (tape.minute >= SESSION_MINUTES) {
      tape.day++
      tape.minute = 0
      openSession()
    }
    const m = tape.minute
    if (m === moveAt) {
      // Two or three times a day the market decides it belongs somewhere else,
      // walks there, and settles: that is what leaves two volume clusters.
      level = level * (1 + (rnd() < 0.5 ? -1 : 1) * (0.004 + rnd() * 0.007))
      moveAt = m + 70 + Math.floor(rnd() * 110)
    }
    const open = price
    // Pulled toward the level, with noise: an Ornstein-Uhlenbeck step.
    const drift = (level - price) * 0.035
    const close = +(price + drift + gauss() * price * 0.00042).toFixed(2)
    const wick = Math.abs(gauss()) * price * 0.00028
    const high = +(Math.max(open, close) + wick * rnd()).toFixed(2)
    const low = +(Math.min(open, close) - wick * rnd()).toFixed(2)
    // Heavy at the open, heavier into the close, quiet over lunch; busier
    // while the price sits on the level it was drawn to.
    const shape = 1 + 2.2 * Math.exp(-m / 22) + 1.5 * Math.exp(-(SESSION_MINUTES - 1 - m) / 26)
    const near = Math.abs(close - level) / price < 0.0012 ? 1.5 : 1
    const volume = Math.round(900 * shape * near * (0.55 + rnd() * 0.9))
    price = close
    tape.minute++
    return { time: sessionOpen(tape.day) + m * MIN, open, high, low, close, volume }
  }
  return tape
}
