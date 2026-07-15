// Pure parser for the CmdBar free-text input. No DOM, no react.
//
// Splits whitespace-separated tokens into recognized `key:value` filter
// pairs (ns/level/source/trace) and leftover bare words, which are joined
// back into a `q` (free-text search) string. Only the *first* colon in a
// token is significant — `ns:auth:*` is key `ns`, value `auth:*` (glob
// patterns routinely contain colons, e.g. `auth:token`).
//
// `q:` is also recognized as an explicit free-text prefix: its value joins
// the same q search as bare words, so `q:"label":"Dogs"` and the bare
// `"label":"Dogs"` are equivalent (both substring-match msg + ctx JSON).

import type { Filters } from './filters'

const KEY_RE = /^(ns|level|source|trace|q):(.+)$/

export interface ParsedCmdInput {
  /** Only the filter keys actually present as `key:value` tokens in the input. */
  filters: Partial<Pick<Filters, 'ns' | 'level' | 'source' | 'trace'>>
  /** Bare (non key:value) words, joined with single spaces. Empty string if none. */
  q: string
}

export function parseCmdInput(input: string): ParsedCmdInput {
  const tokens = input.split(/\s+/).filter((t) => t !== '')
  const filters: ParsedCmdInput['filters'] = {}
  const words: string[] = []

  for (const token of tokens) {
    const m = KEY_RE.exec(token)
    if (m && m[1] === 'q') {
      // explicit free-text prefix — its value joins the q search
      words.push(m[2])
    } else if (m) {
      const key = m[1] as 'ns' | 'level' | 'source' | 'trace'
      filters[key] = m[2]
    } else {
      words.push(token)
    }
  }

  return { filters, q: words.join(' ') }
}
