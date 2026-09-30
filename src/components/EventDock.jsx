import React, { useMemo, useState } from 'react'
import { Icon } from './Icons.jsx'

const TABS = [
  { id: 'selected', label: 'Selected' },
  { id: 'document', label: 'Document' },
  { id: 'events', label: 'Events' },
]

const CAP = 24000

/** JSON, capped: 500 drawings is a megabyte of text and a <pre> that size is its own performance bug. */
function jsonOf(value) {
  let s = ''
  try { s = JSON.stringify(value, null, 2) } catch (_) { s = '' }
  if (s.length <= CAP) return s
  return `${s.slice(0, CAP)}\n… ${(s.length - CAP).toLocaleString()} more characters`
}

/**
 * The inspector: what the library actually stores, and what it actually
 * says. Every panel is a plain view of the public API. `Selected` is the
 * `select` event's payload, `Document` is `getDrawings()`, and `Events` is a
 * log of what the subscribers were told, in the order they were told. If the
 * demo ever disagrees with the docs, this is where it shows.
 */
export default function EventDock({ dc, open, selected, log, docRev, onClear, onClose, children }) {
  const [tab, setTab] = useState('selected')
  const [copied, setCopied] = useState(false)

  const selText = useMemo(() => (selected ? jsonOf(selected) : ''), [selected])
  // Rebuilt only while its tab is showing: a closed dock costs nothing per edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const docText = useMemo(() => (open && tab === 'document' && dc ? jsonOf(dc.getDrawings()) : ''), [open, tab, dc, docRev])
  const docCount = open && tab === 'document' && dc ? dc.getDrawings().length : 0

  const copy = async () => {
    const text = tab === 'selected' ? selText : tab === 'document' ? jsonOf(dc ? dc.getDrawings() : []) : ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch (_) {
      setCopied(false)
    }
  }

  return (
    <aside className={`dock${open ? ' open' : ''}`} aria-label="Inspector" aria-hidden={!open}>
      <div className="dock-in">
        <div className="dock-head">
          <div className="dock-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`dock-tab${tab === t.id ? ' on' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'events' && log.length > 0 && <i>{log.length}</i>}
              </button>
            ))}
          </div>
          <button type="button" className="dock-x" aria-label="Close inspector" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="dock-body">
          {tab === 'selected' &&
            (selected ? (
              <pre className="json">{selText}</pre>
            ) : (
              <p className="dock-empty">Select a drawing to see exactly what is stored for it. Carried keys, offsets and the full options object are all here.</p>
            ))}
          {tab === 'document' && (
            <>
              <p className="dock-note">
                <code>getDrawings()</code> · {docCount} drawing{docCount === 1 ? '' : 's'}, z-ascending
              </p>
              <pre className="json">{docText || '[]'}</pre>
            </>
          )}
          {tab === 'events' &&
            (log.length ? (
              <ol className="evlog">
                {log.map((e) => (
                  <li key={e.n}>
                    <span className="ev-t">{e.t}</span>
                    <b className={`ev ev-${e.name}`}>{e.name}</b>
                    <span className="ev-x">{e.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dock-empty">
                Draw something. <code>change</code> fires once per commit, never per drag frame, and never for a load.
              </p>
            ))}
        </div>

        <div className="dock-foot">
          {tab === 'events' ? (
            <button type="button" className="btn" onClick={onClear} disabled={!log.length}>Clear log</button>
          ) : (
            <button type="button" className="btn" onClick={copy} disabled={tab === 'selected' && !selected}>
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
          )}
          {children}
        </div>
      </div>
    </aside>
  )
}
