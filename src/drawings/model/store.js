/**
 * The document: every drawing (and every carried inert entry), in z order.
 *
 * Entries are deep-frozen, so the store never copies one; it swaps whole
 * references. `list` is a NEW frozen array after every change and is never
 * mutated in place, which makes two things cheap and exact:
 *
 * - a snapshot is just holding on to `list` (batch() rolls back by handing it
 *   to replaceAll), and
 * - "did anything change since I last looked" is an identity comparison, for
 *   the scene as much as for a host.
 *
 * Changes are per id (put), because that is the unit an undo entry records
 * and the unit a host stores (one row per drawing).
 */
import { sameDrawing } from './schema.js'

const EMPTY = Object.freeze([])

/** Index of the first entry whose z is greater than `z`: insert there to stay stable. */
function upperBoundZ(list, z) {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].z <= z) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class DrawingStore {
  constructor() {
    /** z-ascending, frozen; replaced (never mutated) on every change. */
    this.list = EMPTY
    this._byId = new Map()
  }

  get(id) {
    return this._byId.get(id) || null
  }

  /** Inert ids included: they take part in id uniqueness like any drawing. */
  has(id) {
    return this._byId.has(id)
  }

  get size() {
    return this.list.length
  }

  /**
   * Replace the whole document (a load, or a batch rollback). The entries are
   * stable-sorted by z; a duplicate id is a caller bug and throws before
   * anything changes, because the id index and the list would disagree.
   */
  replaceAll(entries) {
    const byId = new Map()
    const list = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (byId.has(e.id)) throw new Error(`DrawingStore: duplicate id "${e.id}"`)
      byId.set(e.id, e)
      list.push(e)
    }
    list.sort((a, b) => a.z - b.z)
    this._byId = byId
    this.list = Object.freeze(list)
  }

  /**
   * Set one id: insert, replace, or (d === null) remove. An entry whose z did
   * not change keeps its slot, so re-committing a drawing never reorders it
   * among equal-z neighbours; otherwise it goes after every entry of equal z,
   * the same place a stable sort would put a newcomer.
   */
  put(id, d) {
    const prev = this._byId.get(id)
    if (d === null || d === undefined) {
      if (!prev) return
      const list = this.list.slice()
      list.splice(list.indexOf(prev), 1)
      this._byId.delete(id)
      this.list = Object.freeze(list)
      return
    }
    if (d.id !== id) throw new Error(`DrawingStore: put("${id}") given drawing "${d.id}"`)
    if (prev === d) return
    const list = this.list.slice()
    if (prev) {
      const at = list.indexOf(prev)
      if (prev.z === d.z) {
        list[at] = d
        this._byId.set(id, d)
        this.list = Object.freeze(list)
        return
      }
      list.splice(at, 1)
    }
    list.splice(upperBoundZ(list, d.z), 0, d)
    this._byId.set(id, d)
    this.list = Object.freeze(list)
  }

  /** 0 on an empty document, so bringToFront gives the first drawing z = 1. */
  maxZ() {
    return this.list.length ? this.list[this.list.length - 1].z : 0
  }

  minZ() {
    return this.list.length ? this.list[0].z : 0
  }
}

/**
 * What a change did, per id, in the shape the `change` event carries.
 * A missing id reads as null (absent). Inert entries never appear: they are
 * never edited, and a host must never see a carried row as created or removed.
 * An id whose two sides are deep-equal is not a change.
 */
export function diff(beforeMap, afterMap) {
  const created = []
  const updated = []
  const removed = []
  const visit = (id) => {
    const b = beforeMap.get(id) || null
    const a = afterMap.get(id) || null
    if ((b && b.inert) || (a && a.inert)) return
    if (!b && a) created.push(a)
    else if (b && !a) removed.push(b)
    else if (b && a && !sameDrawing(b, a)) updated.push({ before: b, after: a })
  }
  for (const id of beforeMap.keys()) visit(id)
  for (const id of afterMap.keys()) if (!beforeMap.has(id)) visit(id)
  return { created, updated, removed }
}
