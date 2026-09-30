import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icons.jsx'

const TYPE_LABEL = {
  trendLine: 'Trend line',
  horizontalLine: 'Horizontal line',
  verticalLine: 'Vertical line',
  rectangle: 'Rectangle',
  parallelChannel: 'Parallel channel',
  fibRetracement: 'Fib retracement',
  measure: 'Measure',
  position: 'Position',
  text: 'Text',
}

/**
 * The right-click menu, driven by the controller's `contextmenu` event.
 *
 * The event carries the container-pixel position and the drawing (already
 * selected by the controller), so this is only a list of buttons: the library
 * prevents the browser's own menu exactly while somebody is subscribed, and a
 * right-click on empty chart still gets the browser's menu because no event
 * fires for it.
 *
 * It closes on anything that could invalidate its position: Esc, a press
 * elsewhere, a wheel, a resize, the window losing focus. The press listener is
 * on `pointerdown` in the capture phase, so the chart cannot swallow it first.
 */
export default function DrawingMenu({ dc, menu, areaRef, onClose }) {
  const el = useRef(null)
  const [pos, setPos] = useState(null)
  const d = menu ? menu.drawing : null

  useLayoutEffect(() => {
    const node = el.current
    const area = areaRef.current
    if (!menu || !node || !area) { setPos(null); return }
    const w = node.offsetWidth
    const h = node.offsetHeight
    setPos({
      x: Math.max(6, Math.min(area.clientWidth - w - 6, menu.x)),
      y: Math.max(6, Math.min(area.clientHeight - h - 6, menu.y)),
    })
  }, [menu, areaRef])

  useEffect(() => {
    if (!menu) return undefined
    const away = (e) => { if (!el.current || !el.current.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('wheel', onClose, { passive: true })
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('wheel', onClose)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [menu, onClose])

  if (!menu || !d) return null

  const run = (fn) => () => { fn(dc, d.id); onClose() }
  const item = (icon, label, fn, extra) => (
    <button type="button" className={`cm-item${extra ? ` ${extra}` : ''}`} role="menuitem" onClick={run(fn)}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  )

  return (
    <div
      className="cm"
      ref={el}
      role="menu"
      aria-label="Drawing menu"
      style={{ transform: `translate3d(${pos ? pos.x : menu.x}px, ${pos ? pos.y : menu.y}px, 0)`, opacity: pos ? 1 : 0 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="cm-head">
        {TYPE_LABEL[d.type] || d.type}
        <em>{menu.part}</em>
      </div>
      {d.type === 'text' && item('edit', 'Edit text', (c, i) => c.editText(i))}
      {item('copy', 'Duplicate', (c, i) => { const n = c.duplicate(i); if (n) c.select(n) })}
      {item('front', 'Bring to front', (c, i) => c.bringToFront(i))}
      {item('back', 'Send to back', (c, i) => c.sendToBack(i))}
      {item(d.locked ? 'unlock' : 'lock', d.locked ? 'Unlock' : 'Lock', (c, i) => c.setLocked(i, !d.locked))}
      {item('eyeOff', 'Hide', (c, i) => { c.setVisible(i, false); c.select(null) })}
      <span className="cm-sep" />
      {item('trash', 'Delete', (c, i) => c.remove(i), 'cm-danger')}
    </div>
  )
}
