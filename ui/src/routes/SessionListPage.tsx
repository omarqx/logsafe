import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, deleteSession, type SessionSummary } from '../api'
import { formatDuration, formatStarted } from '../lib/time'
import { sourceColorIndex } from '../lib/sources'
import { isModifierKeyEvent } from '../lib/keyboard'

const REFRESH_MS = 5000
const LOGSAFE_VERSION = 'v0.1.0'

function isActiveElementEditable(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

export function SessionListPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await listSessions()
      setSessions(list)
      setNow(Date.now())
    } catch (err) {
      console.error('[logsafe] failed to load sessions:', err)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => {
      void refresh()
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  // Keep selection stable across refreshes; default to the first row once
  // data has loaded so j/k work without a prior click.
  useEffect(() => {
    if (!sessions) return
    setSelectedId((cur) => {
      if (cur && sessions.some((s) => s.id === cur)) return cur
      return sessions[0]?.id ?? null
    })
  }, [sessions])

  const handleDelete = useCallback(
    async (s: SessionSummary) => {
      const label = s.label ?? s.id
      if (!window.confirm(`Delete session ${label}?`)) return
      try {
        await deleteSession(s.id)
        await refresh()
      } catch (err) {
        console.error('[logsafe] failed to delete session:', err)
      }
    },
    [refresh],
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Let Cmd/Ctrl/Alt-combos reach the browser instead of being
      // intercepted by single-letter shortcuts below (see SessionDetailPage
      // for the matching guard/rationale).
      if (isModifierKeyEvent(e)) return
      if (isActiveElementEditable()) return
      if (!sessions || sessions.length === 0) return

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const idx = sessions.findIndex((s) => s.id === selectedId)
        const base = idx === -1 ? 0 : idx
        const nextIdx = e.key === 'j' ? Math.min(base + 1, sessions.length - 1) : Math.max(base - 1, 0)
        setSelectedId(sessions[nextIdx].id)
        return
      }

      if (e.key === 'Enter') {
        if (selectedId) navigate(`/s/${selectedId}`)
        return
      }

      if (e.key === 'x') {
        const s = sessions.find((s) => s.id === selectedId)
        if (s) void handleDelete(s)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sessions, selectedId, navigate, handleDelete])

  const totalEvents = sessions?.reduce((sum, s) => sum + s.event_count, 0) ?? 0
  const totalErrors = sessions?.reduce((sum, s) => sum + s.error_count, 0) ?? 0

  return (
    <>
      <div className="cols">
        <span></span>
        <span>started</span>
        <span>session</span>
        <span>sources</span>
        <span className="r">events</span>
        <span className="r">errors</span>
        <span className="r">warns</span>
        <span className="r">dur</span>
      </div>

      <div className="rows">
        {sessions === null && <div className="loading-row">loading…</div>}

        {sessions !== null && sessions.length === 0 && (
          <div className="empty-state">
            <p>no sessions yet — POST /v1/log to create one</p>
            <kbd>curl -s localhost:4600/v1/log -d {`'{"msg":"hello world"}'`}</kbd>
          </div>
        )}

        {sessions !== null &&
          sessions.map((s) => {
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
                key={s.id}
                className={`row${s.id === selectedId ? ' selected' : ''}`}
                onClick={() => {
                  setSelectedId(s.id)
                  navigate(`/s/${s.id}`)
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
          })}
      </div>

      <footer>
        <span className="k">logsafe {LOGSAFE_VERSION}</span>
        <span>
          {sessions?.length ?? 0} sessions · {totalEvents.toLocaleString('en-US')} events ·{' '}
          {totalErrors.toLocaleString('en-US')} errors
        </span>
      </footer>
    </>
  )
}
