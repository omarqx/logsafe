// Session detail route — owns the crumb bar header (session summary poll,
// counts, tail indicator) and renders the flat log view below it. The
// flat/filterable/virtualized stream body (CmdBar, PinnedStrip, stream +
// Minimap, StatusBar) lives in components/FlatLogView.tsx so a future plugin
// detail view can compose it too (see Task 16 for the dispatcher that picks
// between them).
import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSession, coreApi, makePluginFetch, type SessionSummary } from '../api'
import { formatDuration } from '../lib/time'
import { FlatLogView } from '../components/FlatLogView'
import { useUrlState } from '../hooks/useUrlState'
import { logsafeRuntime } from '../runtime'
import { uiPlugins } from '../plugins.generated'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'

const SESSION_POLL_MS = 5000
const registry = buildRegistry(uiPlugins)

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
  // Shareable view state (filters, ts mode, pin, sel) — re-added here (Task
  // 13 moved the FlatLogView-internal usage into FlatLogView itself) because
  // a plugin DetailView needs it passed down explicitly via urlState.
  const { params, setParams } = useUrlState()

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

  const crumbbar = (
    <div className="crumbbar">
      <span className="crumb">
        <Link className="crumb-link" to="/">
          sessions
        </Link>{' '}
        / <b>{session?.label ?? id}</b>
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
  )

  // Which installed plugin (if any) owns this session's view.
  const owner = session ? resolveViewOwner(session, registry) : undefined
  // Typed-but-unowned: session carries a non-generic type no installed
  // plugin claims — surface a note above the flat-log fallback.
  const unownedType = session?.types.find((t) => t !== 'generic' && !registry.has(t))

  if (owner?.DetailView) {
    const Detail = owner.DetailView
    return (
      <>
        {crumbbar}
        <Detail
          session={session}
          sessionId={id}
          api={coreApi}
          pluginFetch={makePluginFetch(owner.id ?? owner.type)}
          urlState={{ params, setParams }}
          tokens={logsafeRuntime.tokens}
        />
      </>
    )
  }

  return (
    <>
      {crumbbar}
      {unownedType && (
        <div className="empty-state" style={{ color: 'var(--amber)' }}>
          This session has <b>{unownedType}</b> data. Install the {unownedType} plugin to see its view — showing raw logs.
        </div>
      )}
      <FlatLogView sessionId={id} session={session} onTailChange={handleTailChange} />
    </>
  )
}
