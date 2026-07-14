// Bottom status bar: shown/total counts, tail state, last fetch latency.
export interface StatusBarProps {
  shown: number
  total: number
  activeChipCount: number
  tail: 'live' | 'paused'
  pendingCount: number
  seqCursor: number | null
  lastFetchMs: number | null
  onResume: () => void
}

export function StatusBar({
  shown,
  total,
  activeChipCount,
  tail,
  pendingCount,
  seqCursor,
  lastFetchMs,
  onResume,
}: StatusBarProps) {
  return (
    <footer>
      <span>
        showing {shown.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
        {activeChipCount > 0 ? ` · filtered by ${activeChipCount} chip${activeChipCount === 1 ? '' : 's'}` : ''}
      </span>
      {tail === 'paused' && (
        <span className="paused" onClick={onResume}>
          ⏸ live tail paused{pendingCount > 0 ? ` — ${pendingCount} new` : ''} — scroll to bottom or press{' '}
          <b>G</b> to resume
        </span>
      )}
      <span className="right">
        {seqCursor !== null ? `seq cursor ${seqCursor} · ` : ''}
        GET /events{lastFetchMs !== null ? ` ${lastFetchMs}ms` : ''}
      </span>
    </footer>
  )
}
