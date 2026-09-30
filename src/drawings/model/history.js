/**
 * Undo/redo as per-id diffs.
 *
 * An entry records, for each drawing it changed, the drawing before and after
 * (null = absent). Drawings are frozen, so those are plain references and an
 * entry costs a few Map slots however large the drawing.
 *
 * Per id, not whole-document snapshots, because a snapshot restores
 * EVERYTHING: undoing a drag would also revert whatever the host changed on
 * other drawings in the meantime with { history: false } (a live alert line
 * the backend moved, say). A per-id entry only touches the ids it recorded.
 * The one documented cost: a { history: false } edit to the SAME drawing is
 * overwritten by the undo of an earlier edit to it.
 *
 * Coalescing is deterministic and uses no clock: consecutive entries with the
 * same `coalesce` key (arrow-key nudges of one selection) merge into one,
 * until anything else happens — another operation, an undo, a selection
 * change or a gesture, each of which the controller reports through
 * breakCoalescing().
 */
const DEFAULT_LIMIT = 100

/** A private copy, so merging into the top entry never mutates the caller's object. */
function copyEntry(e) {
  const out = {
    before: new Map(e.before),
    after: new Map(e.after),
    selBefore: e.selBefore ? e.selBefore.slice() : [],
    selAfter: e.selAfter ? e.selAfter.slice() : [],
    reason: e.reason,
  }
  if (e.coalesce != null) out.coalesce = e.coalesce
  return out
}

export class History {
  constructor(limit) {
    this.limit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : DEFAULT_LIMIT
    this._undo = []
    this._redo = []
    /** Whether the top entry may still absorb a push with the same coalesce key. */
    this._open = false
  }

  /**
   * Record a commit. A new commit ends the redo branch: redoing an entry
   * recorded against a document that has since moved on would re-apply
   * drawings over edits it never saw.
   */
  push(e) {
    const top = this._undo[this._undo.length - 1]
    if (this._open && top && e.coalesce != null && top.coalesce === e.coalesce) {
      // Merge: the top keeps the EARLIEST before of each id and takes the
      // latest after, so one undo returns to where the run of nudges began.
      for (const [id, d] of e.after) {
        if (!top.before.has(id)) top.before.set(id, e.before.has(id) ? e.before.get(id) : null)
        top.after.set(id, d)
      }
      for (const [id, d] of e.before) if (!top.before.has(id)) top.before.set(id, d)
      top.selAfter = e.selAfter ? e.selAfter.slice() : []
    } else {
      this._undo.push(copyEntry(e))
      if (this._undo.length > this.limit) this._undo.splice(0, this._undo.length - this.limit)
    }
    this._redo.length = 0
    this._open = true
  }

  breakCoalescing() {
    this._open = false
  }

  /**
   * Apply the top entry's `before` per id: restore, re-insert (z lives inside
   * the drawing, so it lands in its old slot) or remove. Drawings the entry
   * did not record keep their current state.
   */
  undo(store) {
    const entry = this._undo.pop()
    if (!entry) return null
    for (const [id, d] of entry.before) store.put(id, d)
    this._redo.push(entry)
    this._open = false
    return entry
  }

  redo(store) {
    const entry = this._redo.pop()
    if (!entry) return null
    for (const [id, d] of entry.after) store.put(id, d)
    this._undo.push(entry)
    this._open = false
    return entry
  }

  /** A load: no entry may refer to the previous document. */
  clear() {
    this._undo = []
    this._redo = []
    this._open = false
  }

  get canUndo() {
    return this._undo.length > 0
  }

  get canRedo() {
    return this._redo.length > 0
  }

  get undoSize() {
    return this._undo.length
  }

  get redoSize() {
    return this._redo.length
  }
}
