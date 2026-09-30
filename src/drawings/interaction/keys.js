/**
 * Keyboard → intent (§5.7).
 *
 * This file only NAMES what a key means in the current situation; whether the
 * intent applies (a locked drawing, zero bars, nothing to undo) is the state
 * machine's and the controller's call. Returning null means "not ours": the
 * key falls through to the core, which is how the arrow keys keep panning the
 * chart whenever nothing is selected.
 *
 * Ctrl and Meta are accepted interchangeably for shortcuts, as every desktop
 * app does now; only the MAGNET modifier is platform-specific (§5.1), and that
 * is read from the pointer event, not here.
 */

const MODIFIERS = new Set(['Shift', 'Alt', 'Control', 'Meta'])

/** [du, dv] per arrow. Prototype-free, so no key name can read Object.prototype. */
const NUDGE = Object.assign(Object.create(null), {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
})

/**
 * A letter shortcut. By the character when it is a Latin letter (AZERTY's Z
 * is where QWERTY's W is, and Ctrl+Z must follow the label); by the physical
 * key otherwise, so Ctrl+Z still undoes on a Cyrillic or Greek layout.
 */
const letter = (e, ch) => {
  const k = e.key.toLowerCase()
  return /^[a-z]$/.test(k) ? k === ch : e.code === 'Key' + ch.toUpperCase()
}

/**
 * The intent of keydown `e`, or null.
 *
 *   s: { hasSelection, gesture, placing, editing }
 *
 * 'escape' | 'delete' | 'unplace' | 'undo' | 'redo' | 'duplicate' | 'nudge'
 * | 'edit' | 'modifier' | null. For 'nudge', keyEvent() below also carries the
 * step: du in bars (±1, Shift ±10), dv in screen px of price, positive up
 * (±1, Shift ±10).
 */
export function keyIntent(e, s) {
  if (!e || typeof e.key !== 'string') return null
  // The text editor owns every key while it is open (it also stops them
  // propagating); an IME mid-composition owns Enter, Escape and the arrows.
  if (s.editing || e.isComposing) return null
  const key = e.key
  if (MODIFIERS.has(key)) return 'modifier'
  if (key === 'Escape' || key === 'Esc') return 'escape'

  const mod = !!(e.ctrlKey || e.metaKey)
  if (mod && !e.altKey) {
    // Undo mid-gesture is still 'undo': the machine turns it into "cancel the
    // gesture", which is what the hand on the keyboard meant.
    if (letter(e, 'z')) return e.shiftKey ? 'redo' : 'undo'
    if (letter(e, 'y') && !e.shiftKey) return 'redo'
    if (letter(e, 'd') && !e.shiftKey && s.hasSelection && !s.gesture) return 'duplicate'
    return null
  }
  if (mod || e.altKey) return null

  if (key === 'Backspace' && s.placing) return 'unplace'
  if (s.gesture) return null
  if ((key === 'Delete' || key === 'Backspace') && s.hasSelection) return 'delete'
  if (key === 'Enter' && s.hasSelection) return 'edit'
  if (s.hasSelection && NUDGE[key]) return 'nudge'
  return null
}

/**
 * keyIntent as a ready MachineEvent (`{ type: 'key', intent, du, dv }`), or
 * null. The nudge step lives here so the controller never re-parses the key.
 */
export function keyEvent(e, s) {
  const intent = keyIntent(e, s)
  if (!intent) return null
  if (intent !== 'nudge') return { type: 'key', intent }
  const step = e.shiftKey ? 10 : 1
  const v = NUDGE[e.key]
  return { type: 'key', intent, du: v[0] * step, dv: v[1] * step }
}
