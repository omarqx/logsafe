// Pure autocomplete engine for the CmdBar free-text input. No DOM, no react.
//
// `token` is the whitespace-separated word currently being typed (see
// splitLastToken in CmdBar.tsx for how the caller extracts it — everything
// here operates on that single token string in isolation).
//
// Mirrors cmdInput.ts's recognized key set (ns/level/source/trace/q) but
// deliberately does not import from it: cmdInput only needs to *parse* a
// finished token, this only needs to *complete* a partial one, and the two
// have different enough shapes (this needs the raw key/value split before
// the colon is even typed) that sharing code would cost more than it saves.

import type { Filters } from './filters'

export interface SuggestContext {
  sources: string[]
  nsValues: string[]
  traceValues: string[]
}

export interface Suggestion {
  /** Full replacement for the current token, e.g. `level:warn,error`. */
  insert: string
  /** Short display label for the dropdown row. */
  label: string
  /** Optional one-line description, shown only on key-prefix suggestions. */
  hint?: string
}

type ValueKey = Exclude<keyof Filters, 'q'>

const KEY_PREFIXES: Array<{ key: 'ns' | 'level' | 'source' | 'trace' | 'q'; hint: string }> = [
  { key: 'ns', hint: 'namespace glob, e.g. auth:*' },
  { key: 'level', hint: 'debug, info, warn, error' },
  { key: 'source', hint: 'event source' },
  { key: 'trace', hint: 'trace id' },
  { key: 'q', hint: 'free-text search' },
]

const LEVELS = ['debug', 'info', 'warn', 'error']
const MAX_SUGGESTIONS = 8

function matchesPrefix(candidate: string, partial: string): boolean {
  return candidate.toLowerCase().startsWith(partial.toLowerCase())
}

/** Split a comma-list value into everything before the last comma and the partial segment being typed. */
function splitValue(value: string): { prior: string; partial: string } {
  const idx = value.lastIndexOf(',')
  if (idx === -1) return { prior: '', partial: value }
  return { prior: value.slice(0, idx), partial: value.slice(idx + 1) }
}

function buildInsert(key: string, prior: string, completion: string): string {
  return `${key}:${prior ? `${prior},${completion}` : completion}`
}

/** level/source/ns: comma-aware prefix match against a candidate pool, plus (ns only) a glob suggestion. */
function suggestCommaAwareValue(key: ValueKey, value: string, pool: string[], includeGlob: boolean): Suggestion[] {
  const { prior, partial } = splitValue(value)
  const items: Suggestion[] = pool
    .filter((v) => matchesPrefix(v, partial))
    .map((v) => ({ insert: buildInsert(key, prior, v), label: v }))

  if (includeGlob && partial !== '') {
    const glob = `${partial}*`
    items.push({ insert: buildInsert(key, prior, glob), label: glob, hint: 'glob match' })
  }

  return items.slice(0, MAX_SUGGESTIONS)
}

export function suggest(token: string, ctx: SuggestContext): Suggestion[] {
  const colonIdx = token.indexOf(':')

  if (colonIdx === -1) {
    // Bare/partial word: offer key prefixes whose name starts with it.
    const partial = token.toLowerCase()
    return KEY_PREFIXES.filter((k) => k.key.startsWith(partial))
      .slice(0, MAX_SUGGESTIONS)
      .map((k) => ({ insert: `${k.key}:`, label: `${k.key}:`, hint: k.hint }))
  }

  const key = token.slice(0, colonIdx).toLowerCase()
  const value = token.slice(colonIdx + 1)

  switch (key) {
    case 'level':
      return suggestCommaAwareValue('level', value, LEVELS, false)
    case 'source':
      return suggestCommaAwareValue('source', value, ctx.sources, false)
    case 'ns':
      return suggestCommaAwareValue('ns', value, ctx.nsValues, true)
    case 'trace':
      return ctx.traceValues
        .filter((v) => matchesPrefix(v, value))
        .slice(0, MAX_SUGGESTIONS)
        .map((v) => ({ insert: `trace:${v}`, label: v }))
    case 'q':
    default:
      // q: is explicit free text (no completions); any other prefix isn't a
      // recognized filter key, so it has none either.
      return []
  }
}
