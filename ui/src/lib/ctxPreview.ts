// Lazy, cached ctx-preview string for a StoredEvent's inline dim preview in
// LogRow/PinnedStrip. Row rendering must stay O(1) at 100k rows — the JSON
// stringify + truncation happens at most once per distinct event object,
// keyed by identity in a WeakMap (never mutates the event, never leaks:
// entries are collected once the event itself is garbage-collected).

import type { StoredEvent } from '../api'

const cache = new WeakMap<StoredEvent, string>()
const MAX_LEN = 120

/**
 * Returns a truncated `JSON.stringify(ev.ctx)` (max 120 chars, `…` suffix
 * when truncated), or `''` when `ctx` is `null`/`undefined`. Computed once
 * per event object and cached for subsequent calls (re-renders, re-scrolls
 * back into the virtualized viewport, etc).
 */
export function getCtxPreview(ev: StoredEvent): string {
  if (ev.ctx === null || ev.ctx === undefined) return ''

  const cached = cache.get(ev)
  if (cached !== undefined) return cached

  let s: string
  try {
    s = JSON.stringify(ev.ctx)
  } catch {
    return ''
  }
  if (s.length > MAX_LEN) {
    s = `${s.slice(0, MAX_LEN)}…`
  }
  cache.set(ev, s)
  return s
}
