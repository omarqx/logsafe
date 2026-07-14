// Expanded ctx panel rendered under a selected LogRow/PinnedStrip row.
// Pretty-prints ev.ctx with key/string/number token colors, plus a small
// actions row (copy json, filter by trace, seq/received_at metadata).
import { useCallback, type ReactNode } from 'react'
import type { StoredEvent } from '../api'
import { formatTs } from '../lib/time'

export interface CtxPanelProps {
  ev: StoredEvent
  sessionStart: number
  onFilterTrace: (trace: string) => void
}

// Tokenizes a JSON.stringify(..., null, 2) string into colored spans:
// object keys (`"k":`) get .k, other strings get .s, numbers/true/false/null
// get .n — matches the ctxpanel token classes ported from the mockup CSS.
const TOKEN_RE =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function highlightJson(json: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(json))) {
    if (m.index > lastIndex) parts.push(json.slice(lastIndex, m.index))
    const token = m[0]
    const isKey = token.startsWith('"') && /:\s*$/.test(token)
    const isString = token.startsWith('"') && !isKey
    const cls = isKey ? 'k' : isString ? 's' : 'n'
    parts.push(
      <span key={key++} className={cls}>
        {token}
      </span>,
    )
    lastIndex = TOKEN_RE.lastIndex
  }
  if (lastIndex < json.length) parts.push(json.slice(lastIndex))
  return parts
}

export function CtxPanel({ ev, sessionStart, onFilterTrace }: CtxPanelProps) {
  const pretty = ev.ctx === null || ev.ctx === undefined ? 'null' : JSON.stringify(ev.ctx, null, 2)
  const recv = formatTs('rel', { ts: ev.received_at }, sessionStart, null)

  const copyJson = useCallback(() => {
    // Optional chaining short-circuits the whole expression (including
    // .catch) when clipboard is unavailable, so this is safe even then; the
    // .catch itself guards against a real browser rejecting the write (e.g.
    // permissions denied) turning into an unhandled promise rejection.
    navigator.clipboard?.writeText(pretty).catch(() => {})
  }, [pretty])

  const filterTrace = useCallback(() => {
    if (ev.trace) onFilterTrace(ev.trace)
  }, [ev.trace, onFilterTrace])

  return (
    <div className="ctxpanel" onClick={(e) => e.stopPropagation()}>
      {highlightJson(pretty)}
      <div className="actions">
        <span onClick={copyJson}>copy json</span>
        {ev.trace && <span onClick={filterTrace}>filter trace</span>}
        <span>
          seq {ev.seq} · recv {recv}
        </span>
      </div>
    </div>
  )
}
