/**
 * The options of a volume profile: defaults, and the one place they are
 * validated. A bad option is a programmer error and throws with the option's
 * name in the message, from createVolumeProfile and setOptions alike, before
 * anything is changed.
 */

export const DEFAULTS = Object.freeze({
  /** 'session' | 'visible' | 'both' */
  mode: 'session',
  /** Longest bar: a share of the session's pixel span, or of the pane width for the visible profile. */
  width: 0.3,
  /** Which side of the pane the visible profile grows from. */
  side: 'right',
  valueArea: true,
  poc: true,
  extendPoc: false,
  tags: true,
  label: true,
  hideFutureInReplay: true,
  /** Partial<ProfileColors>, or null for the theme's. */
  colors: null,
})

const MODES = ['session', 'visible', 'both']
const SIDES = ['left', 'right']
const FLAGS = ['valueArea', 'poc', 'extendPoc', 'tags', 'label', 'hideFutureInReplay']

const fail = (msg) => { throw new Error(`emberwick/profiles: ${msg}`) }

/**
 * `base` with the recognised keys of `partial` applied, as a new object.
 * Unknown keys are ignored, and so is `data`, which has its own setter. A key
 * present as `undefined` keeps its current value, so `{ ...defaults, ...user }`
 * style callers cannot blank an option by accident.
 */
export function mergeOptions(base, partial) {
  const o = { ...base }
  if (partial == null) return o
  if (typeof partial !== 'object') fail('options must be an object')
  if (partial.mode !== undefined) {
    if (!MODES.includes(partial.mode)) fail(`mode must be 'session', 'visible' or 'both' (got ${String(partial.mode)})`)
    o.mode = partial.mode
  }
  if (partial.side !== undefined) {
    if (!SIDES.includes(partial.side)) fail(`side must be 'left' or 'right' (got ${String(partial.side)})`)
    o.side = partial.side
  }
  if (partial.width !== undefined) {
    const w = +partial.width
    if (typeof partial.width !== 'number' || !(w > 0 && w < Infinity)) fail(`width must be a number above 0 (got ${String(partial.width)})`)
    // A share of a span: more than all of it would run a bar out of its session.
    o.width = Math.min(w, 1)
  }
  for (const k of FLAGS) if (partial[k] !== undefined) o[k] = !!partial[k]
  if (partial.colors !== undefined) {
    if (partial.colors !== null && typeof partial.colors !== 'object') fail('colors must be an object or null')
    o.colors = partial.colors ? { ...partial.colors } : null
  }
  return o
}
