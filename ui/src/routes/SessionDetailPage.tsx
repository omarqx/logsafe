// Session detail route — owns the crumb bar header (session summary poll,
// counts, tail indicator) and renders the flat log view below it. The
// flat/filterable/virtualized stream body (CmdBar, PinnedStrip, stream +
// Minimap, StatusBar) lives in components/FlatLogView.tsx so a future plugin
// detail view can compose it too (see Task 16 for the dispatcher that picks
// between them).
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getSession, type SessionSummary } from '../api'
import { formatDuration } from '../lib/time'
import { FlatLogView } from '../components/FlatLogView'

const SESSION_POLL_MS = 5000

interface TailInfo {
  tail: 'live' | 'paused'
  pendingCount: number
  resume: () => void
}

export function SessionDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [session, setSession] = useState<SessionSummary | null>(null)
  // Tail live/paused + resume mirrored up from FlatLogView (see
  // FlatLogView's onTailChange doc) so the crumb-bar chip below can keep
  // showing it exactly as it did before the flat-view body moved into its
  // own component.
  const [tailInfo, setTailInfo] = useState<TailInfo>({ tail: 'live', pendingCount: 0, resume: () => {} })
  const handleTailChange = useCallback((tail: 'live' | 'paused', pendingCount: number, resume: () => void) => {
    setTailInfo({ tail, pendingCount, resume })
  }, [])

  // Session summary (totals for the header/status bar) — polled like the
  // session list, since it's independent of the filtered event stream.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await getSession(id)
        if (!cancelled) setSession(s)
      } catch (err) {
        console.error('[logsafe] failed to load session:', err)
      }
    }
    void load()
    const iv = setInterval(() => void load(), SESSION_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [id])

  return (
    <>
      <div className="crumbbar">
        <span className="crumb">
          sessions / <b>{session?.label ?? id}</b>
          {session?.label ? <> · {id}</> : null}
        </span>
        <div className="counts">
          <span>{(session?.event_count ?? 0).toLocaleString('en-US')} events</span>
          <span className="e">{(session?.error_count ?? 0).toLocaleString('en-US')} errors</span>
          <span className="w">{(session?.warn_count ?? 0).toLocaleString('en-US')} warns</span>
          <span>
            {(session?.sources ?? []).join(' + ')} · {formatDuration(session?.duration_ms ?? 0)}
          </span>
        </div>
        <span
          className={`tailchip${tailInfo.tail === 'paused' ? ' paused' : ''}`}
          onClick={tailInfo.tail === 'paused' ? tailInfo.resume : undefined}
        >
          {tailInfo.tail === 'paused'
            ? `tail paused${tailInfo.pendingCount > 0 ? ` — ${tailInfo.pendingCount} new` : ''}`
            : 'tail live'}
        </span>
      </div>

      <FlatLogView sessionId={id} session={session} onTailChange={handleTailChange} />
    </>
  )
}
