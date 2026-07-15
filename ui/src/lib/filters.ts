// Pure URL <-> Filters helpers. The URL is the source of truth for filter
// state; these functions never touch the DOM, storage, or the network.

export interface Filters {
  ns?: string
  level?: string
  source?: string
  trace?: string
  q?: string
  // Non-destructive "clear" seq floor (`c` key, see SessionDetailPage):
  // events with seq <= after are hidden client-side. Deliberately NOT part
  // of FILTER_KEYS/filtersToApiParams — it's not a server-side filter, it's
  // the initial cursor useEventStream loads/tails from (see its floorSeq
  // param), so it must never leak into per-page after_seq params.
  after?: number
}

const FILTER_KEYS = ['ns', 'level', 'source', 'trace', 'q'] as const

/** Read the known filter keys out of a URLSearchParams. Empty/absent values are omitted. */
export function filtersFromSearch(sp: URLSearchParams): Filters {
  const f: Filters = {}
  for (const key of FILTER_KEYS) {
    const v = sp.get(key)
    if (v) f[key] = v
  }
  const afterRaw = sp.get('after')
  if (afterRaw) {
    const n = Number(afterRaw)
    if (Number.isFinite(n) && Number.isInteger(n)) f.after = n
  }
  return f
}

/**
 * Apply a Filters object onto a base URLSearchParams, preserving any other
 * keys already present (e.g. `ts`, `pin`, `sel`) untouched. Filter keys
 * absent from `f` are removed from the result. Never mutates `base`.
 */
export function filtersToSearch(f: Filters, base?: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(base)
  for (const key of FILTER_KEYS) {
    const v = f[key]
    if (v) {
      sp.set(key, v)
    } else {
      sp.delete(key)
    }
  }
  if (f.after !== undefined) {
    sp.set('after', String(f.after))
  } else {
    sp.delete('after')
  }
  return sp
}

/** Build the query params to send to the events API — only the API-known filter keys. */
export function filtersToApiParams(f: Filters): URLSearchParams {
  const sp = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const v = f[key]
    if (v) sp.set(key, v)
  }
  return sp
}

/** 'e' keyboard shortcut: toggle the level filter to/from 'warn,error'. */
export function toggleErrorLevel(f: Filters): Filters {
  const isErr = f.level === 'warn,error'
  return { ...f, level: isErr ? undefined : 'warn,error' }
}
