// A single row in the virtualized log stream. Memoized: re-renders only
// when its own primitives/callbacks change, never scans state.events or any
// other array — the ctx preview is precomputed+cached (lib/ctxPreview) so
// this component's own render work stays O(1) regardless of session size.
import { memo, type MouseEvent } from 'react'
import type { StoredEvent } from '../api'
import { getCtxPreview } from '../lib/ctxPreview'
import { CtxPanel } from './CtxPanel'

export interface LogRowProps {
  ev: StoredEvent
  sourceIdx: number
  tsLabel: string
  isSelected: boolean
  isExpanded: boolean
  isPinned: boolean
  sessionStart: number
  onSelect: (seq: number) => void
  onToggleExpand: (seq: number) => void
  onTraceClick: (trace: string) => void
}

function levelText(level: StoredEvent['level']): string {
  return level === 'warn' || level === 'error' ? level.toUpperCase() : level
}

function LogRowImpl({
  ev,
  sourceIdx,
  tsLabel,
  isSelected,
  isExpanded,
  isPinned,
  sessionStart,
  onSelect,
  onToggleExpand,
  onTraceClick,
}: LogRowProps) {
  const rowClass = [
    'logrow',
    ev.level === 'debug' && 'is-debug',
    ev.level === 'warn' && 'is-warn',
    ev.level === 'error' && 'is-error',
    isSelected && 'selected',
  ]
    .filter(Boolean)
    .join(' ')

  const preview = getCtxPreview(ev)

  function handleCaretClick(e: MouseEvent) {
    e.stopPropagation()
    onToggleExpand(ev.seq)
  }

  function handleTraceClick(e: MouseEvent) {
    e.stopPropagation()
    if (ev.trace) onTraceClick(ev.trace)
  }

  return (
    <div className={rowClass} data-seq={ev.seq} onClick={() => onSelect(ev.seq)}>
      <span className={`gut gut-${sourceIdx}`} />
      <span className="ts">{tsLabel}</span>
      <span className={`src src-${sourceIdx}`}>{ev.source}</span>
      <span className="ns" title={ev.ns}>
        {ev.ns}
      </span>
      <span className={`lvl ${ev.level}`}>{levelText(ev.level)}</span>
      <span className="msg">
        <span className="caret" onClick={handleCaretClick}>
          {isExpanded ? '▾' : '▸'}
        </span>
        {isPinned && <span className="pin">⌖</span>}
        {ev.msg}
        {preview && <span className="ctxprev"> {preview}</span>}
        {ev.trace && (
          <span className="trace" onClick={handleTraceClick}>
            {ev.trace}
          </span>
        )}
      </span>
      {isExpanded && <CtxPanel ev={ev} sessionStart={sessionStart} onFilterTrace={onTraceClick} />}
    </div>
  )
}

export const LogRow = memo(LogRowImpl)
