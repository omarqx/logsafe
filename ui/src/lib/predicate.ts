// Pure client-side mirror of the server's event filter semantics
// (packages/server/src/queries.ts `queryEvents`). Used to test SSE tail
// events against the current URL filters without a round trip, so the tail
// respects filters without refetching. No DOM, no fetch, no react.

import type { StoredEvent } from '../api'
import type { Filters } from './filters'

function csv(v: string): string[] {
  return v
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

// Only '*' is a wildcard (matches any run of characters, including none);
// everything else in the pattern is a literal, mirroring the server's GLOB
// translation (nsToGlob) where '[' and '?' are escaped to literals too.
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g

function nsPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(REGEX_SPECIAL, (c) => (c === '*' ? '.*' : `\\${c}`))
  return new RegExp(`^${escaped}$`)
}

/** Case-sensitive, like SQLite GLOB. `*` matches any substring, anywhere in the pattern. */
export function matchNs(pattern: string, ns: string): boolean {
  return nsPatternToRegExp(pattern).test(ns)
}

/** SQLite LIKE folds only ASCII case — mirror that exactly. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

/**
 * Mirrors queryEvents' WHERE clause: every filter present is AND-ed together;
 * ns/level/source are comma-lists OR-ed within themselves; trace is exact;
 * q is a substring search over msg OR JSON.stringify(ctx), case-insensitive
 * only for ASCII letters — mirrors SQLite LIKE, which does not fold
 * non-ASCII case (e.g. 'İ'/'i' don't match) — via asciiLower, not
 * String.prototype.toLowerCase (which does full Unicode folding)
 * (ctx === null never matches q, same as `ctx LIKE ?` against a SQL NULL).
 */
export function eventMatches(f: Filters, ev: StoredEvent): boolean {
  if (f.ns) {
    const pats = csv(f.ns)
    if (pats.length > 0 && !pats.some((p) => matchNs(p, ev.ns))) return false
  }
  if (f.level) {
    const levels = csv(f.level)
    if (levels.length > 0 && !levels.includes(ev.level)) return false
  }
  if (f.source) {
    const sources = csv(f.source)
    if (sources.length > 0 && !sources.includes(ev.source)) return false
  }
  if (f.trace) {
    if (ev.trace !== f.trace) return false
  }
  if (f.q) {
    const q = asciiLower(f.q)
    const inMsg = asciiLower(ev.msg).includes(q)
    const inCtx = ev.ctx !== null && asciiLower(JSON.stringify(ev.ctx)).includes(q)
    if (!inMsg && !inCtx) return false
  }
  return true
}
