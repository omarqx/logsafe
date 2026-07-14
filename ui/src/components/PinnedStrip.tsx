// Pinned events, shown above the stream regardless of active filters. Same
// row anatomy as LogRow (gutter/ts/src/ns/lvl/msg) plus an always-visible
// ⌖ marker that unpins on click. Pin lists are tiny (a handful of rows) so
// this isn't virtualized or memoized per-row like the main stream.
import type { StoredEvent } from '../api'
import { sourceColorIndex } from '../lib/sources'
import { getCtxPreview } from '../lib/ctxPreview'
import { formatTs, type TsMode } from '../lib/time'

export interface PinnedStripProps {
  pinned: StoredEvent[]
  sources: string[]
  tsMode: TsMode
  sessionStart: number
  selSeq: number | null
  onSelect: (seq: number) => void
  onUnpin: (seq: number) => void
  onTraceClick: (trace: string) => void
}

function levelText(level: StoredEvent['level']): string {
  return level === 'warn' || level === 'error' ? level.toUpperCase() : level
}

export function PinnedStrip({
  pinned,
  sources,
  tsMode,
  sessionStart,
  selSeq,
  onSelect,
  onUnpin,
  onTraceClick,
}: PinnedStripProps) {
  if (pinned.length === 0) return null

  return (
    <div className="pinned">
      <div className="cap">PINNED · {pinned.length}</div>
      {pinned.map((ev, i) => {
        const prevTs = i > 0 ? pinned[i - 1].ts : null
        const sourceIdx = sourceColorIndex(sources, ev.source)
        const preview = getCtxPreview(ev)
        const rowClass = [
          'logrow',
          ev.level === 'debug' && 'is-debug',
          ev.level === 'warn' && 'is-warn',
          ev.level === 'error' && 'is-error',
          ev.seq === selSeq && 'selected',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div key={ev.seq} className={rowClass} data-seq={ev.seq} onClick={() => onSelect(ev.seq)}>
            <span className={`gut gut-${sourceIdx}`} />
            <span className="ts">{formatTs(tsMode, ev, sessionStart, prevTs)}</span>
            <span className={`src src-${sourceIdx}`}>{ev.source}</span>
            <span className="ns" title={ev.ns}>
              {ev.ns}
            </span>
            <span className={`lvl ${ev.level}`}>{levelText(ev.level)}</span>
            <span className="msg">
              <span
                className="pin"
                onClick={(e) => {
                  e.stopPropagation()
                  onUnpin(ev.seq)
                }}
              >
                ⌖
              </span>
              {ev.msg}
              {preview && <span className="ctxprev"> {preview}</span>}
              {ev.trace && (
                <span
                  className="trace"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (ev.trace) onTraceClick(ev.trace)
                  }}
                >
                  {ev.trace}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
