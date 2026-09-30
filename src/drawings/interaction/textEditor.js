/**
 * The in-place text editor (§5.8): a <textarea> laid over a text drawing.
 *
 * A canvas cannot take text input, and a prompt() would be hostile, so the
 * editor is a real form control positioned exactly over the drawing's box.
 * Everything here touches the DOM, and only inside functions: importing this
 * module during SSR must not reach for `document`.
 *
 * The one rule that shapes this file: iOS Safari raises the on-screen keyboard
 * only for a focus() made synchronously inside the user's own touch handler.
 * So openTextEditor creates, attaches and focuses in one call, and the
 * controller calls it straight from its pointerUp / doubleClick / keyDown
 * hook — never from an effect queue, a frame, a timer or a promise.
 */

/** Events that would otherwise reach the chart and pan, zoom or re-select under the editor. */
const ISOLATED = ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel', 'keyup']

const px = (v) => `${Math.round(v)}px`

/** Place `ta` over `box`. A non-finite box (a drawing scrolled into a NaN) keeps the last position. */
function place(ta, box) {
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return
  ta.style.left = px(box.x)
  ta.style.top = px(box.y)
  // A floor, so an empty draft is still something to type into.
  ta.style.width = px(Math.max(Number.isFinite(box.w) ? box.w : 0, 40))
  ta.style.height = px(Math.max(Number.isFinite(box.h) ? box.h : 0, 18))
}

/**
 * Open the editor inside `container` at `box` (container px) and focus it.
 *
 *   init: { text, font, color, bg }
 *   on:   { commit(text), cancel() }
 *
 * Enter commits (Shift+Enter is a newline; Enter that ends an IME composition
 * is the IME's), Escape cancels, blur commits. Commit and cancel each happen
 * at most once, remove the textarea, and hand focus back to the container so
 * the chart's own keys (Delete, undo, the arrows) work again straight away.
 *
 * Returns { el, reposition(box), close() }. close() removes the editor
 * WITHOUT calling back — for detach, or when the controller has already read
 * the value — and is idempotent too.
 */
export function openTextEditor(container, box, init, on) {
  const ta = document.createElement('textarea')
  const st = ta.style
  st.position = 'absolute'
  // Above every chart canvas, the overlay (crosshair) included.
  st.zIndex = '10'
  st.margin = '0'
  st.padding = '1px 3px'
  st.border = '1px solid ' + (init.color || 'currentColor')
  st.borderRadius = '3px'
  st.outline = 'none'
  st.resize = 'none'
  st.overflow = 'hidden'
  st.whiteSpace = 'pre'
  st.boxSizing = 'border-box'
  st.font = init.font || ''
  st.lineHeight = '1.25'
  st.color = init.color || ''
  st.background = init.bg || 'transparent'
  // The container disables selection while drawings are enabled (§7.6); an
  // editor you cannot select text in is not an editor.
  st.userSelect = 'text'
  st.webkitUserSelect = 'text'
  ta.value = init.text == null ? '' : String(init.text)
  if (typeof ta.setAttribute === 'function') {
    ta.setAttribute('aria-label', 'Drawing text')
    ta.setAttribute('spellcheck', 'false')
  }
  place(ta, box)

  let done = false
  let lastBox = box

  const stop = (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation() }

  const handlers = {
    keydown(e) {
      stop(e)
      // Safari reports the Enter that CONFIRMS a composition as keyCode 229
      // with isComposing already false; treat it as the IME's too.
      if (e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        if (typeof e.preventDefault === 'function') e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape' || e.key === 'Esc') {
        if (typeof e.preventDefault === 'function') e.preventDefault()
        finish(false)
      }
    },
    input() {
      // Grow with the text; the canvas box only catches up on commit.
      const w = ta.scrollWidth
      const h = ta.scrollHeight
      if (Number.isFinite(w) && w > 0) st.width = px(Math.max(w + 2, lastBox && lastBox.w > 0 ? lastBox.w : 0, 40))
      if (Number.isFinite(h) && h > 0) st.height = px(Math.max(h + 2, 18))
    },
    blur() { finish(true) },
  }
  for (const t of ISOLATED) handlers[t] = stop

  const names = Object.keys(handlers)
  for (const t of names) ta.addEventListener(t, handlers[t])

  function teardown() {
    for (const t of names) ta.removeEventListener(t, handlers[t])
    if (typeof ta.remove === 'function') ta.remove()
  }

  function finish(commit) {
    if (done) return
    // Flag first: removing or refocusing away from a focused textarea fires
    // blur in some engines, and that blur must not commit an Escape.
    done = true
    const text = String(ta.value)
    teardown()
    if (container && typeof container.focus === 'function') container.focus({ preventScroll: true })
    if (commit) on.commit(text)
    else on.cancel()
  }

  container.appendChild(ta)
  ta.focus()
  // Select the placeholder so the first keystroke replaces it.
  if (typeof ta.select === 'function') ta.select()

  return {
    el: ta,
    reposition(b) {
      if (done) return
      lastBox = b
      place(ta, b)
    },
    close() {
      if (done) return
      done = true
      teardown()
    },
  }
}
