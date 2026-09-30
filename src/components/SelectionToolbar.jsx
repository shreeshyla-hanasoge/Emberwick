import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { Icon } from './Icons.jsx'

/** null is "follow the theme": the swatch is drawn half light, half dark. */
const COLORS = [null, '#f5a524', '#6ea8fe', '#26a69a', '#ef5350', '#c084fc', '#9aa3b2']
const WIDTHS = [1, 1.5, 2, 3, 4]
const DASHES = ['solid', 'dashed', 'dotted']
const GAP = 10
const EDGE = 6

/**
 * What each stored type actually reads. A control that does nothing to the
 * selected drawing is worse than no control, so the toolbar offers only the
 * ones the tool honours: a position takes its colours from the theme's
 * up/down (so no swatches), a text has a font size where a line has a width.
 */
const CAPS = {
  trendLine: { color: true, width: true, dash: true },
  horizontalLine: { color: true, width: true, dash: true },
  verticalLine: { color: true, width: true, dash: true },
  rectangle: { color: true, width: true, dash: true },
  parallelChannel: { color: true, width: true, dash: true },
  fibRetracement: { width: true, dash: true },
  measure: { color: true },
  position: {},
  text: { color: true, font: true, edit: true },
}
const NONE = {}

const near = (list, v) => {
  let best = 0
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i
  return best
}

/**
 * The floating selection toolbar.
 *
 * It is positioned from the controller's `box` state event, and it moves its
 * own element inside that callback instead of going through React state. The
 * event fires from the chart's frame, so writing the transform right there
 * puts the toolbar in the same paint as the drawing it follows. A setState
 * would be flushed after the frame and the toolbar would trail a pan by one
 * frame, which is exactly the "glued" property the event exists to provide.
 *
 * It sits above the box, flips below when there is no room, and is clamped
 * into the chart area so it can never leave it, whatever the drawing does.
 * While a drawing is being created or dragged it fades back (the `drawing`
 * stream is the signal), because a toolbar under the pointer is in the way of
 * the thing the reader is doing.
 */
export default function SelectionToolbar({ dc, drawing, areaRef }) {
  const el = useRef(null)
  const placeRef = useRef(null)

  const id = drawing ? drawing.id : null
  const type = drawing ? drawing.type : null

  useEffect(() => {
    if (!dc) return undefined
    const node = el.current
    const place = (p) => {
      const area = areaRef.current
      if (!node || !area) return
      const box = p && p.id ? p.box : null
      if (!box) { node.classList.remove('show'); return }
      const W = node.offsetWidth
      const H = node.offsetHeight
      const aw = area.clientWidth
      const ah = area.clientHeight
      const x = Math.max(EDGE, Math.min(aw - W - EDGE, box.x + box.w / 2 - W / 2))
      const above = box.y - H - GAP
      const y = above >= EDGE ? above : Math.max(EDGE, Math.min(ah - H - EDGE, box.y + box.h + GAP))
      node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      node.classList.add('show')
    }
    placeRef.current = place

    let quiet = 0
    const offStream = dc.subscribe('drawing', () => {
      node.classList.add('busy')
      clearTimeout(quiet)
      quiet = setTimeout(() => node.classList.remove('busy'), 220)
    })
    const offBox = dc.subscribe('box', place)
    return () => {
      offStream()
      offBox()
      clearTimeout(quiet)
      placeRef.current = null
    }
  }, [dc, areaRef])

  // The toolbar's width depends on the type (a text has no dash button), so
  // it is re-placed whenever the selected drawing changes shape, before paint.
  useLayoutEffect(() => {
    const place = placeRef.current
    if (!place) return
    place({ id, box: id && dc ? dc.screenBox(id) : null })
  }, [dc, id, type, drawing && drawing.locked])

  const caps = (type && CAPS[type]) || NONE
  const st = (drawing && drawing.style) || NONE
  const wIdx = near(WIDTHS, st.lineWidth || 1)
  const cur = (st.color || '').toLowerCase()

  const set = (patch) => { if (dc && id) dc.update(id, { style: patch }) }
  const act = (fn) => () => { if (dc && id) fn(dc, id) }

  return (
    <div className="seltb" ref={el} onMouseDown={(e) => e.preventDefault()}>
      <div className="seltb-in" role="toolbar" aria-label="Selected drawing" aria-orientation="horizontal">
        {caps.color && (
          <div className="sw-row" role="group" aria-label="Colour">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c || 'theme'}
                className={`sw${(c ? c === cur : !cur) ? ' on' : ''}${c ? '' : ' sw-theme'}`}
                style={c ? { background: c } : undefined}
                aria-label={c ? `Colour ${c}` : 'Follow the theme'}
                title={c ? c : 'Follow the theme'}
                onClick={() => set({ color: c })}
              />
            ))}
          </div>
        )}
        {caps.color && (caps.width || caps.font || caps.edit) && <span className="tb-sep" />}

        {caps.width && (
          <button
            type="button"
            className="tb-btn"
            title={`Line width ${st.lineWidth || 1}px`}
            aria-label={`Line width ${st.lineWidth || 1} pixels, click for the next`}
            onClick={() => set({ lineWidth: WIDTHS[(wIdx + 1) % WIDTHS.length] })}
          >
            <span className="wbar" style={{ height: Math.max(1, WIDTHS[wIdx]) }} />
          </button>
        )}
        {caps.dash && (
          <button
            type="button"
            className="tb-btn"
            title={`Line style: ${st.lineStyle || 'solid'}`}
            aria-label={`Line style ${st.lineStyle || 'solid'}, click for the next`}
            onClick={() => set({ lineStyle: DASHES[(Math.max(0, DASHES.indexOf(st.lineStyle)) + 1) % DASHES.length] })}
          >
            <Icon name={st.lineStyle || 'solid'} size={20} />
          </button>
        )}
        {caps.font && (
          <>
            <button
              type="button"
              className="tb-btn"
              title="Smaller text"
              aria-label="Smaller text"
              onClick={() => set({ fontSize: Math.max(9, (st.fontSize || 12) - 2) })}
            >
              <Icon name="minus" size={15} />
            </button>
            <span className="tb-read" title="Font size">{st.fontSize || 12}</span>
            <button
              type="button"
              className="tb-btn"
              title="Larger text"
              aria-label="Larger text"
              onClick={() => set({ fontSize: Math.min(32, (st.fontSize || 12) + 2) })}
            >
              <Icon name="plus" size={15} />
            </button>
          </>
        )}
        {caps.edit && (
          <button type="button" className="tb-btn" title="Edit text (Enter)" aria-label="Edit text" onClick={act((d, i) => d.editText(i))}>
            <Icon name="edit" size={16} />
          </button>
        )}
        {(caps.width || caps.dash || caps.font || caps.edit) && <span className="tb-sep" />}

        <button
          type="button"
          className={`tb-btn${drawing && drawing.locked ? ' on' : ''}`}
          title={drawing && drawing.locked ? 'Unlock' : 'Lock: the chart pans through it'}
          aria-label={drawing && drawing.locked ? 'Unlock' : 'Lock'}
          aria-pressed={!!(drawing && drawing.locked)}
          onClick={act((d, i) => d.setLocked(i, !(drawing && drawing.locked)))}
        >
          <Icon name={drawing && drawing.locked ? 'lock' : 'unlock'} size={16} />
        </button>
        <button
          type="button"
          className="tb-btn"
          title="Hide (Show hidden brings it back)"
          aria-label="Hide"
          onClick={act((d, i) => { d.setVisible(i, false); d.select(null) })}
        >
          <Icon name="eyeOff" size={16} />
        </button>
        <button
          type="button"
          className="tb-btn"
          title="Duplicate (Ctrl/Cmd+D)"
          aria-label="Duplicate"
          onClick={act((d, i) => { const n = d.duplicate(i); if (n) d.select(n) })}
        >
          <Icon name="copy" size={16} />
        </button>
        <button type="button" className="tb-btn" title="Bring to front" aria-label="Bring to front" onClick={act((d, i) => d.bringToFront(i))}>
          <Icon name="front" size={16} />
        </button>
        <button type="button" className="tb-btn" title="Send to back" aria-label="Send to back" onClick={act((d, i) => d.sendToBack(i))}>
          <Icon name="back" size={16} />
        </button>
        <span className="tb-sep" />
        <button type="button" className="tb-btn tb-danger" title="Delete (Del)" aria-label="Delete" onClick={act((d, i) => d.remove(i))}>
          <Icon name="trash" size={16} />
        </button>
      </div>
    </div>
  )
}
