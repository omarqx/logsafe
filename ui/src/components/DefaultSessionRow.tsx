import type { SessionSummary } from '../api'
import { formatDuration, formatStarted } from '../lib/time'
import { sourceColorIndex } from '../lib/sources'

export interface DefaultSessionRowProps {
  session: SessionSummary
  now: number
  selected: boolean
  onOpen(): void
  onSelect(): void
}

export function DefaultSessionRow({ session: s, now, selected, onOpen, onSelect }: DefaultSessionRowProps) {
  const { time, day } = formatStarted(s.first_ts, now)
  const isScratch = s.label === null
  // Unlabeled sessions get a server-generated id like
  // 'scratch-2026-07-13' (see normalize.ts#scratchSessionId) that's
  // already a readable label, so fall back to it instead of
  // inventing one — and skip the id sub-span when it would just
  // repeat that same string.
  const displayLabel = s.label ?? s.id
  return (
    <div
      className={`row${selected ? ' selected' : ''}`}
      onClick={() => {
        onSelect()
        onOpen()
      }}
    >
      <span className={`status ${s.status}`}>●</span>
      <span className="when">
        <b>{time}</b> {day}
      </span>
      <span className={`label${isScratch ? ' scratch' : ''}`}>
        {displayLabel}
        {displayLabel !== s.id && <span className="id">{s.id}</span>}
      </span>
      <span className="srcs">
        {s.sources.map((src) => (
          <span key={src} className={`src src-${sourceColorIndex(s.sources, src)}`}>
            {src}
          </span>
        ))}
      </span>
      <span className="num count">{s.event_count.toLocaleString('en-US')}</span>
      <span className={`errors ${s.error_count > 0 ? 'some' : 'zero'}`}>
        {s.error_count.toLocaleString('en-US')}
      </span>
      <span className={`warns${s.warn_count === 0 ? ' zero' : ''}`}>
        {s.warn_count.toLocaleString('en-US')}
      </span>
      <span className="dur">{formatDuration(s.duration_ms)}</span>
    </div>
  )
}
