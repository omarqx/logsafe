// Session detail route — the core screen: header (crumb/counts/tail),
// CmdBar (filters), pinned strip, virtualized log stream, ctx panel, status
// bar. URL is the single source of truth for filters/ts/pin/sel (see
// hooks/useUrlState.ts, lib/filters.ts) — everything here derives from
// `params` and writes back through `setParams`, so a copied URL reproduces
// the exact view in a fresh tab.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getSession, type SessionSummary, type StoredEvent } from '../api'
import { useUrlState } from '../hooks/useUrlState'
import { useEventStream } from '../hooks/useEventStream'
import { filtersFromSearch, filtersToSearch, filtersToApiParams, toggleErrorLevel, type Filters } from '../lib/filters'
import { formatTs, formatDuration, type TsMode } from '../lib/time'
import { sourceColorIndex } from '../lib/sources'
import { CmdBar } from '../components/CmdBar'
import { LogRow } from '../components/LogRow'
import { PinnedStrip } from '../components/PinnedStrip'
import { StatusBar } from '../components/StatusBar'

const ROW_H = 20
const OVERSCAN = 40
const SESSION_POLL_MS = 5000
const TS_ORDER: TsMode[] = ['abs', 'rel', 'delta']

function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

function parseSeqList(v: string | null): number[] {
  if (!v) return []
  return v
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}

export function SessionDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { params, setParams } = useUrlState()

  const filters = filtersFromSearch(params)
  const apiParams = filtersToApiParams(filters)
  const tsMode = ((params.get('ts') as TsMode | null) ?? 'rel') as TsMode
  const pinSeqs = useMemo(() => parseSeqList(params.get('pin')), [params])
  const selSeq = params.get('sel') ? Number(params.get('sel')) : null

  const [session, setSession] = useState<SessionSummary | null>(null)
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null)
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null)

  const [state, api] = useEventStream(id, apiParams, pinSeqs)

  const cmdInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)

  // Session summary (totals for the header/status bar) — polled like the
  // session list, since it's independent of the filtered event stream.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const s = await getSession(id)
      if (!cancelled) setSession(s)
    }
    void load()
    const iv = setInterval(() => void load(), SESSION_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [id])

  // Approximate "last fetch latency" for the status bar: wall-clock time of
  // the initial progressive load (loading true -> false transition). The
  // hook doesn't expose per-request timing, so this is the closest proxy
  // available without changing its interface.
  const loadStartRef = useRef<number | null>(null)
  useEffect(() => {
    if (state.loading) {
      loadStartRef.current = performance.now()
    } else if (loadStartRef.current !== null) {
      setLastFetchMs(Math.round(performance.now() - loadStartRef.current))
      loadStartRef.current = null
    }
  }, [state.loading])

  // sources list for gutter/source color assignment: prefer the session
  // summary's (stable, alphabetical) list; fall back to first-appearance
  // order in the loaded events until the summary arrives.
  const sourcesList = useMemo(() => {
    if (session?.sources && session.sources.length > 0) return session.sources
    const seen = new Set<string>()
    const list: string[] = []
    for (const ev of state.events) {
      if (!seen.has(ev.source)) {
        seen.add(ev.source)
        list.push(ev.source)
      }
    }
    return list
  }, [session, state.events])

  const sessionStart = session?.first_ts ?? state.events[0]?.ts ?? 0

  // --- URL-writing mutators -------------------------------------------

  const updateFilters = useCallback(
    (next: Filters) => {
      setParams(filtersToSearch(next, params), { replace: false })
    },
    [params, setParams],
  )

  const updateTsMode = useCallback(
    (mode: TsMode) => {
      const next = new URLSearchParams(params)
      next.set('ts', mode)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const setSelSeq = useCallback(
    (seq: number | null) => {
      const next = new URLSearchParams(params)
      if (seq === null) next.delete('sel')
      else next.set('sel', String(seq))
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const togglePin = useCallback(
    (seq: number) => {
      const next = new URLSearchParams(params)
      const seqs = parseSeqList(next.get('pin'))
      const idx = seqs.indexOf(seq)
      if (idx === -1) seqs.push(seq)
      else seqs.splice(idx, 1)
      if (seqs.length === 0) next.delete('pin')
      else next.set('pin', seqs.join(','))
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const handleTraceClick = useCallback(
    (trace: string) => {
      updateFilters({ ...filters, trace })
    },
    [filters, updateFilters],
  )

  const handleRowSelect = useCallback(
    (seq: number) => {
      setSelSeq(seq)
    },
    [setSelSeq],
  )

  const handleRowToggleExpand = useCallback(
    (seq: number) => {
      setSelSeq(seq)
      setExpandedSeq((cur) => (cur === seq ? null : seq))
    },
    [setSelSeq],
  )

  const resumeAndScrollBottom = useCallback(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
    api.resume()
  }, [api])

  // --- virtualization + scroll behavior --------------------------------

  const rowVirtualizer = useVirtualizer({
    count: state.events.length,
    getScrollElement: () => streamRef.current,
    estimateSize: () => ROW_H,
    overscan: OVERSCAN,
  })

  // Stick to bottom while tail is live: whenever the event count grows (or
  // tail flips back to live), snap the scroll position to the end.
  useEffect(() => {
    if (state.tail !== 'live') return
    const el = streamRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [state.events.length, state.tail])

  // "Any upward scroll -> pause()", read directly off the wheel gesture
  // rather than off scrollTop deltas: the virtualizer's dynamic row
  // remeasurement (measureElement/ResizeObserver) can shrink the total
  // content size by sub-pixel amounts as rows settle, which makes the
  // browser silently clamp scrollTop *down* on its own — a scrollTop-delta
  // check misreads that as the user scrolling up and pauses on every load.
  // A negative wheel deltaY is an unambiguous, directly user-driven signal.
  const onStreamWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0 && state.tail === 'live') {
        api.pause()
      }
    },
    [state.tail, api],
  )

  // --- keyboard map (constraints minus minimap, owned by Task 6) -------

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        ;(document.activeElement as HTMLElement | null)?.blur()
        return
      }
      if (isEditable(document.activeElement)) return

      switch (e.key) {
        case '/':
        case 'f':
          e.preventDefault()
          cmdInputRef.current?.focus()
          return
        case 'j':
        case 'k': {
          if (state.events.length === 0) return
          e.preventDefault()
          const idx = state.events.findIndex((ev) => ev.seq === selSeq)
          const base = idx === -1 ? 0 : idx
          const nextIdx = e.key === 'j' ? Math.min(base + 1, state.events.length - 1) : Math.max(base - 1, 0)
          setSelSeq(state.events[nextIdx].seq)
          rowVirtualizer.scrollToIndex(nextIdx, { align: 'auto' })
          return
        }
        case 'Enter':
        case 'o':
          if (selSeq !== null) {
            e.preventDefault()
            setExpandedSeq((cur) => (cur === selSeq ? null : selSeq))
          }
          return
        case 'p':
          if (selSeq !== null) {
            e.preventDefault()
            togglePin(selSeq)
          }
          return
        case 't': {
          e.preventDefault()
          const next = TS_ORDER[(TS_ORDER.indexOf(tsMode) + 1) % TS_ORDER.length]
          updateTsMode(next)
          return
        }
        case 'e':
          e.preventDefault()
          updateFilters(toggleErrorLevel(filters))
          return
        case 'g':
          e.preventDefault()
          if (state.events.length > 0) rowVirtualizer.scrollToIndex(0, { align: 'start' })
          return
        case 'G':
          e.preventDefault()
          resumeAndScrollBottom()
          return
        default:
          return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    state.events,
    selSeq,
    tsMode,
    filters,
    togglePin,
    updateFilters,
    updateTsMode,
    setSelSeq,
    rowVirtualizer,
    resumeAndScrollBottom,
  ])

  const activeChipCount = Object.values(filters).filter((v) => Boolean(v)).length
  const pinnedSet = useMemo(() => new Set(pinSeqs), [pinSeqs])

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
          className={`tailchip${state.tail === 'paused' ? ' paused' : ''}`}
          onClick={state.tail === 'paused' ? resumeAndScrollBottom : undefined}
        >
          {state.tail === 'paused'
            ? `tail paused${state.pendingCount > 0 ? ` — ${state.pendingCount} new` : ''}`
            : 'tail live'}
        </span>
      </div>

      <CmdBar
        filters={filters}
        onChangeFilters={updateFilters}
        tsMode={tsMode}
        onChangeTsMode={updateTsMode}
        inputRef={cmdInputRef}
      />

      <PinnedStrip
        pinned={state.pinned}
        sources={sourcesList}
        tsMode={tsMode}
        sessionStart={sessionStart}
        selSeq={selSeq}
        onSelect={handleRowSelect}
        onUnpin={togglePin}
        onTraceClick={handleTraceClick}
      />

      <div className="stream-wrap">
        <div className="stream" ref={streamRef} onWheel={onStreamWheel}>
          {state.loading && <div className="loading-row">loading…</div>}
          {state.error && <div className="loading-row">error: {state.error}</div>}
          {!state.loading && !state.error && state.events.length === 0 && (
            <div className="empty-state">
              <p>no events match the current filters</p>
            </div>
          )}
          {!state.loading && !state.error && state.events.length > 0 && (
            <div style={{ position: 'relative', height: rowVirtualizer.getTotalSize() }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const ev: StoredEvent = state.events[virtualRow.index]
                const prevTs = virtualRow.index > 0 ? state.events[virtualRow.index - 1].ts : null
                return (
                  <div
                    key={ev.seq}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <LogRow
                      ev={ev}
                      sourceIdx={sourceColorIndex(sourcesList, ev.source)}
                      tsLabel={formatTs(tsMode, ev, sessionStart, prevTs)}
                      isSelected={ev.seq === selSeq}
                      isExpanded={ev.seq === expandedSeq}
                      isPinned={pinnedSet.has(ev.seq)}
                      sessionStart={sessionStart}
                      onSelect={handleRowSelect}
                      onToggleExpand={handleRowToggleExpand}
                      onTraceClick={handleTraceClick}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <StatusBar
        shown={state.events.length}
        total={session?.event_count ?? 0}
        activeChipCount={activeChipCount}
        tail={state.tail}
        pendingCount={state.pendingCount}
        seqCursor={state.events.at(-1)?.seq ?? null}
        lastFetchMs={lastFetchMs}
        onResume={resumeAndScrollBottom}
      />
    </>
  )
}
