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
import { formatTs, formatDuration, parseTsMode, type TsMode } from '../lib/time'
import { sourceColorIndex } from '../lib/sources'
import { binEvents, minimapFractionToIndex, type MinimapBin } from '../lib/minimap'
import { isModifierKeyEvent } from '../lib/keyboard'
import { CmdBar } from '../components/CmdBar'
import { LogRow } from '../components/LogRow'
import { PinnedStrip } from '../components/PinnedStrip'
import { StatusBar } from '../components/StatusBar'
import { Minimap, type MinimapErrorMark } from '../components/Minimap'

const ROW_H = 20
const OVERSCAN = 40
const SESSION_POLL_MS = 5000
const TS_ORDER: TsMode[] = ['abs', 'rel', 'delta']
const MINIMAP_BIN_COUNT = 60
// How far above the bottom (px) a non-programmatic scroll must land before
// it counts as "the user scrolled up" for onStreamScroll (item 3, see there).
const PAUSE_DISTANCE_FROM_BOTTOM_PX = 40
// binEvents does an O(n) pass over the full event list. `state.events` gets a
// new array identity on every SSE tail frame while live, so recomputing on
// every render would make the minimap an O(n)-per-incoming-event cost during
// a busy tail. Throttle recompute to ~4/s (250ms) while tail is live;
// recompute immediately for any other transition (paused, filter change,
// initial load) since those are low-frequency and user-driven, where
// staleness would actually be visible.
const MINIMAP_THROTTLE_MS = 250

interface MinimapData {
  bins: MinimapBin[]
  errors: MinimapErrorMark[]
}

// A 0.25%-tall slot along the strip; ~400 slots fit a 30px-tall minimap
// (way finer than a mark is visually distinguishable at), so quantizing to
// this grid for dedup below is visually lossless.
const ERROR_MARK_SLOT_PCT = 0.25

export function computeMinimapData(events: StoredEvent[]): MinimapData {
  const { bins, errors } = binEvents(events, MINIMAP_BIN_COUNT)
  // binEvents pushes an error mark, in event order, for every 'error'-level
  // event but only returns its `top` position (it's a pure ts/level ->
  // geometry mapping with no knowledge of StoredEvent's seq field) — zip the
  // marks back up with the seq of the error event at the same ordinal
  // position so the minimap can show/jump to a specific seq.
  //
  // Dedupe by quantized `top`: an error storm (e.g. a retry loop logging
  // hundreds/thousands of errors within one bin's time span) would otherwise
  // render one DOM node per error event, unbounded. Keep only the first
  // (earliest seq) mark per slot — ≤ 400 slots means ≤ 400 nodes regardless
  // of how many error events share a position.
  const marks: MinimapErrorMark[] = []
  const seenSlots = new Set<number>()
  let mi = 0
  for (const ev of events) {
    if (ev.level === 'error') {
      const top = errors[mi]!.top
      mi++
      const slot = Math.round(top / ERROR_MARK_SLOT_PCT)
      if (seenSlots.has(slot)) continue
      seenSlots.add(slot)
      marks.push({ top, seq: ev.seq })
    }
  }
  return { bins, errors: marks }
}

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

  // Memoized on `params` (react-router memoizes that object by
  // location.search, see useUrlState.ts), not recomputed fresh every
  // render: a plain `filtersFromSearch(params)` call here made a new object
  // every render regardless of whether the URL changed, which defeated
  // `React.memo` on LogRow (see handleTraceClick below, whose `[filters,
  // updateFilters]` deps churned every render — every SSE tail event/5s
  // session poll — forcing every visible row to re-render).
  const filters = useMemo(() => filtersFromSearch(params), [params])
  const apiParams = filtersToApiParams(filters)
  const tsMode = parseTsMode(params.get('ts'))
  const pinSeqs = useMemo(() => parseSeqList(params.get('pin')), [params])
  const selSeq = params.get('sel') ? Number(params.get('sel')) : null

  const [session, setSession] = useState<SessionSummary | null>(null)
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null)
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null)

  const [state, api] = useEventStream(id, apiParams, pinSeqs)
  // useEventStream returns a fresh `{ pause, resume, refetch }` object
  // literal every render even though the functions themselves are stable
  // (useCallback with empty deps in the hook) — depending on `api` as a
  // whole in a useCallback/useEffect dep array reintroduces the same churn
  // filters just fixed above. Depend on the individual functions instead.
  const { pause, resume } = api

  const cmdInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)

  // Session summary (totals for the header/status bar) — polled like the
  // session list, since it's independent of the filtered event stream.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await getSession(id)
        if (!cancelled) setSession(s)
      } catch (err) {
        console.error('[deblog] failed to load session:', err)
      }
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
    resume()
  }, [resume])

  // --- virtualization + scroll behavior --------------------------------

  const rowVirtualizer = useVirtualizer({
    count: state.events.length,
    getScrollElement: () => streamRef.current,
    estimateSize: () => ROW_H,
    overscan: OVERSCAN,
  })
  // The virtualizer measures each row's *real* height as it mounts
  // (measureElement/ResizeObserver) and this updates on every such
  // measurement — not just when state.events.length changes — which is
  // exactly what the stick-to-bottom effect below needs to depend on: a
  // row's real height can differ from the ROW_H estimate, so the total
  // content height keeps changing for a few renders after events first
  // load, independently of the event count itself. Read once and reused
  // (JSX height below, minimap geometry further down) instead of calling
  // getTotalSize() repeatedly per render.
  const totalSize = rowVirtualizer.getTotalSize()

  // True while a scrollTop write below is *our own* stick-to-bottom
  // correction, not the user. onStreamScroll reads this to tell "we just
  // snapped to bottom" apart from "the user moved the scrollbar/PageUp/
  // touch themselves" — see there for why the wheel handler alone doesn't
  // catch every user-driven scroll.
  const programmaticScrollRef = useRef(false)
  // Mirrors state.tail for the fonts.ready effect further down, which
  // deliberately has an empty dep array (fonts.ready only ever resolves
  // once) and so can't close over state.tail directly without seeing a
  // stale value from whenever the component first mounted.
  const tailStateRef = useRef(state.tail)
  useEffect(() => {
    tailStateRef.current = state.tail
  }, [state.tail])

  // Stick to bottom while tail is live: whenever the content height changes
  // (new events arrive, tail flips back to live, or a row's *measured*
  // height turns out to differ from the ROW_H estimate — see `totalSize`
  // above), snap the scroll position to the end.
  useEffect(() => {
    if (state.tail !== 'live') return
    const el = streamRef.current
    if (!el) return
    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
    // The 'scroll' event this write triggers (if scrollTop actually moved)
    // is asynchronous — consumed by the *next* scroll event in
    // onStreamScroll below, whenever it lands, rather than time-boxed here.
    // This rAF is only a fallback for when the write didn't move scrollTop
    // at all (already at bottom), so no 'scroll' event fires to consume it.
    const raf = requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
    return () => cancelAnimationFrame(raf)
  }, [totalSize, state.tail])

  // Fonts (@fontsource/jetbrains-mono, self-hosted, loaded async) can swap
  // in after first paint and shift every element's line-height/metrics —
  // including the header/toolbar rows above .stream — which changes
  // .stream's own clientHeight (not something `totalSize` above observes,
  // since that only tracks the virtualizer's row measurements). Re-snap
  // once more when fonts finish loading so that late shift doesn't leave a
  // live tail short of the true bottom. One-shot and cheap: `fonts.ready`
  // resolves once and stays resolved for the tab's lifetime.
  useEffect(() => {
    let cancelled = false
    void document.fonts?.ready?.then(() => {
      if (cancelled) return
      if (tailStateRef.current !== 'live') return
      const el = streamRef.current
      if (!el) return
      programmaticScrollRef.current = true
      el.scrollTop = el.scrollHeight
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    })
    return () => {
      cancelled = true
    }
    // Deliberately runs once (mount only): fonts.ready resolves once per
    // page lifetime, and re-subscribing per state.tail change would be
    // pointless (the promise is already settled after the first resolution)
    // — tailStateRef (not a dependency) is what keeps the *check* current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Any upward scroll -> pause()", read directly off the wheel gesture
  // rather than off scrollTop/distance-from-bottom: it's an unambiguous,
  // directly user-driven signal, so it doesn't need the
  // programmaticScrollRef bookkeeping the scroll-position check below does
  // to avoid mistaking our own stick-to-bottom corrections for the user
  // scrolling up. Kept alongside that check (harmless, and reacts a tick
  // faster than waiting for the resulting 'scroll' event).
  const onStreamWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0 && state.tail === 'live') {
        pause()
      }
    },
    [state.tail, pause],
  )

  // Catches every other way to scroll up that the wheel handler above
  // misses: dragging the scrollbar thumb, PageUp/Home, touch scroll, or a
  // trackpad gesture that doesn't fire 'wheel'. Any 'scroll' event that
  // wasn't caused by our own stick-to-bottom write (programmaticScrollRef)
  // and that leaves the viewport more than ~40px above the bottom, while
  // the tail is live, pauses — otherwise stick-to-bottom would just snap it
  // right back on the next incoming event, making those gestures a no-op.
  const onStreamScroll = useCallback(() => {
    if (programmaticScrollRef.current) {
      // Consume: this is (almost certainly) the event our own write above
      // triggered, whether it arrived before or after that effect's rAF
      // fallback already cleared the flag — either way it's the one event
      // we meant to ignore. Not a plain time-boxed ignore-window, which
      // would either race the event (too short) or risk swallowing a fast
      // real user scroll that follows immediately (too long).
      programmaticScrollRef.current = false
      return
    }
    if (state.tail !== 'live') return
    const el = streamRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > PAUSE_DISTANCE_FROM_BOTTOM_PX) {
      pause()
    }
  }, [state.tail, pause])

  // --- keyboard map (constraints minus minimap, owned by Task 6) -------

  // Mirrors state.events for the keydown handler below without making that
  // effect re-subscribe (teardown + re-add the document listener) on every
  // SSE tail frame: state.events gets a new array identity on every
  // incoming event while live, and the handler only ever needs the latest
  // array at keypress time, not a reactive subscription to it.
  const eventsRef = useRef(state.events)
  useEffect(() => {
    eventsRef.current = state.events
  }, [state.events])

  // --- minimap data (throttled, see MINIMAP_THROTTLE_MS above) ----------

  const [minimapData, setMinimapData] = useState<MinimapData>(() => computeMinimapData(state.events))
  const minimapTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (state.tail !== 'live') {
      setMinimapData(computeMinimapData(state.events))
      return
    }
    if (minimapTimerRef.current !== null) return // a recompute is already scheduled this window
    minimapTimerRef.current = window.setTimeout(() => {
      minimapTimerRef.current = null
      setMinimapData(computeMinimapData(eventsRef.current))
    }, MINIMAP_THROTTLE_MS)
  }, [state.events, state.tail])

  // True-unmount-only cleanup for the pending timer. Deliberately not the
  // per-dependency-change cleanup of the effect above: that would cancel and
  // reschedule on every SSE tail frame, turning the throttle into a debounce
  // (never firing while events keep streaming in). Must also null the ref,
  // not just clearTimeout it — React StrictMode's dev-mode mount → cleanup →
  // remount cycle runs this cleanup once even though the component stays
  // mounted; leaving a dangling non-null ref after clearing would make the
  // `!== null` guard above think a recompute is still scheduled forever,
  // and the minimap would never populate after the first render.
  useEffect(
    () => () => {
      if (minimapTimerRef.current !== null) {
        clearTimeout(minimapTimerRef.current)
        minimapTimerRef.current = null
      }
    },
    [],
  )

  const jumpToFraction = useCallback(
    (fraction: number) => {
      const events = eventsRef.current
      if (events.length === 0) return
      if (state.tail === 'live') pause()
      const idx = minimapFractionToIndex(fraction, events.length)
      setSelSeq(events[idx].seq)
      rowVirtualizer.scrollToIndex(idx, { align: 'center' })
    },
    [state.tail, pause, setSelSeq, rowVirtualizer],
  )

  const jumpToError = useCallback(
    (seq: number) => {
      const events = eventsRef.current
      const idx = events.findIndex((ev) => ev.seq === seq)
      if (idx === -1) return
      if (state.tail === 'live') pause()
      setSelSeq(seq)
      rowVirtualizer.scrollToIndex(idx, { align: 'center' })
    },
    [state.tail, pause, setSelSeq, rowVirtualizer],
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Let Cmd/Ctrl/Alt-combos (Cmd+F find-in-page, Cmd+P print, ...)
      // reach the browser instead of being intercepted by single-letter app
      // shortcuts below (e.g. 'f' would otherwise steal focus from Cmd+F).
      if (isModifierKeyEvent(e)) return
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
          const events = eventsRef.current
          if (events.length === 0) return
          e.preventDefault()
          const idx = events.findIndex((ev) => ev.seq === selSeq)
          const base = idx === -1 ? 0 : idx
          const nextIdx = e.key === 'j' ? Math.min(base + 1, events.length - 1) : Math.max(base - 1, 0)
          setSelSeq(events[nextIdx].seq)
          // Pause the live tail before moving the view: otherwise the
          // stick-to-bottom effect snaps scrollTop back to the bottom on
          // the next tail event, discarding this navigation. Always pause
          // while live rather than special-casing "already at the bottom
          // row" (which technically wouldn't need it) — detecting that
          // cheaply isn't worth the complexity; selection still moves via
          // setSelSeq either way.
          if (state.tail === 'live') pause()
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
          if (eventsRef.current.length > 0) {
            // Same reasoning as j/k above: pause live tail before the jump
            // so stick-to-bottom doesn't immediately undo it.
            if (state.tail === 'live') pause()
            rowVirtualizer.scrollToIndex(0, { align: 'start' })
          }
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
    // state.events is deliberately excluded — see eventsRef above. state.tail
    // and pause are included since j/k/g now read/call them directly.
  }, [
    selSeq,
    tsMode,
    filters,
    togglePin,
    updateFilters,
    updateTsMode,
    setSelSeq,
    rowVirtualizer,
    resumeAndScrollBottom,
    state.tail,
    pause,
  ])

  const activeChipCount = Object.values(filters).filter((v) => Boolean(v)).length
  const pinnedSet = useMemo(() => new Set(pinSeqs), [pinSeqs])

  // Minimap viewport indicator: percentages 0..100 of the strip's height.
  // While tail is live it's pinned to the bottom outright (matching the
  // stick-to-bottom scroll behavior) rather than trusting the virtualizer's
  // scrollOffset, which can lag a frame behind a just-arrived tail row
  // before the stick-to-bottom effect commits the scrollTop write.
  const minimapViewportPx = rowVirtualizer.scrollRect?.height ?? 0
  const minimapViewportHeight = totalSize > 0 ? Math.min(100, (minimapViewportPx / totalSize) * 100) : 100
  const minimapViewportTop =
    state.tail === 'live'
      ? Math.max(0, 100 - minimapViewportHeight)
      : totalSize > 0
        ? ((rowVirtualizer.scrollOffset ?? 0) / totalSize) * 100
        : 0

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
        <div className="stream" ref={streamRef} onWheel={onStreamWheel} onScroll={onStreamScroll}>
          {state.loading && <div className="loading-row">loading…</div>}
          {state.error && <div className="loading-row">error: {state.error}</div>}
          {!state.loading && !state.error && state.events.length === 0 && (
            <div className="empty-state">
              <p>no events match the current filters</p>
            </div>
          )}
          {!state.loading && !state.error && state.events.length > 0 && (
            <div style={{ position: 'relative', height: totalSize }}>
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
        <Minimap
          bins={minimapData.bins}
          errors={minimapData.errors}
          viewportTop={minimapViewportTop}
          viewportHeight={minimapViewportHeight}
          onJump={jumpToFraction}
          onJumpToError={jumpToError}
        />
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
