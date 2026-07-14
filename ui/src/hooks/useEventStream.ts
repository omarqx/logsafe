// Progressive page-load + filtered SSE live tail + pins, per docs/superpowers
// plans/2026-07-13-deblog-phase4-ui.md (Task 4). Filters are applied
// server-side for the initial page load (apiParams goes straight to
// fetchEventsPage) and client-side for the SSE tail (the /stream endpoint
// has no filter params — see API.md — so every event is re-tested locally
// with the exact same predicate the server uses, lib/predicate.ts).
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchEventsPage, type StoredEvent } from '../api'
import { filtersFromSearch } from '../lib/filters'
import { eventMatches } from '../lib/predicate'

export interface StreamState {
  events: StoredEvent[] // filtered, seq ASC, append-only identity (stable refs for memo rows)
  loading: boolean // initial page load in progress
  tail: 'live' | 'paused'
  pendingCount: number // events buffered while paused
  pinned: StoredEvent[] // resolved pin=seqs, independent of filters
  error: string | null
}

export interface StreamApi {
  pause(): void
  resume(): void // flushes pending into events
  refetch(): void // filters changed → reset + reload
}

// Injectable so tests can stub EventSource without jsdom polyfills — named
// SSE events (`event: log`) don't fire `onmessage`, so real jsdom support
// for EventSource wouldn't even help here; we need addEventListener('log').
let ESFactory: (url: string) => EventSource = (url) => new EventSource(url)
export function _setEventSourceFactoryForTests(factory: (url: string) => EventSource): void {
  ESFactory = factory
}

const PAGE_LIMIT = 10_000
const RECONNECT_DELAY_MS = 1000

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useEventStream(
  sessionId: string,
  apiParams: URLSearchParams,
  pinSeqs: number[],
): [StreamState, StreamApi] {
  const [events, setEvents] = useState<StoredEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [tail, setTail] = useState<'live' | 'paused'>('live')
  const [pending, setPending] = useState<StoredEvent[]>([])
  const [pinned, setPinned] = useState<StoredEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Monotonic generation counter: every async continuation (fetch page,
  // SSE frame, reconnect timer) checks it before touching state, so
  // stale work from a prior sessionId/filter/refetch cycle — or work
  // still in flight after unmount — is a silent no-op instead of a bug.
  const genRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSeqRef = useRef(0)
  const tailRef = useRef<'live' | 'paused'>('live')
  const pendingRef = useRef<StoredEvent[]>([])
  const filtersRef = useRef(filtersFromSearch(apiParams))

  const apiParamsKey = apiParams.toString()

  useEffect(() => {
    const myGen = ++genRef.current
    filtersRef.current = filtersFromSearch(apiParams)
    tailRef.current = 'live'
    pendingRef.current = []
    lastSeqRef.current = 0
    setTail('live')
    setPending([])
    setEvents([])
    setError(null)
    setLoading(true)

    function teardownStream(): void {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }

    function connect(): void {
      if (myGen !== genRef.current) return
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/stream?after_seq=${lastSeqRef.current}`
      const es = ESFactory(url)
      esRef.current = es

      es.addEventListener('log', (frame) => {
        if (myGen !== genRef.current) return
        let parsed: StoredEvent
        try {
          parsed = JSON.parse((frame as MessageEvent).data) as StoredEvent
        } catch {
          return // malformed frame — ignore, cursor unchanged
        }
        // Advance the resume cursor even for events the filter drops, so a
        // reconnect never re-requests (and re-drops) the same events.
        lastSeqRef.current = parsed.seq
        if (!eventMatches(filtersRef.current, parsed)) return
        if (tailRef.current === 'paused') {
          pendingRef.current = [...pendingRef.current, parsed]
          setPending(pendingRef.current)
        } else {
          setEvents((prev) => [...prev, parsed])
        }
      })

      es.onerror = () => {
        if (myGen !== genRef.current) return
        es.close()
        reconnectTimerRef.current = setTimeout(() => {
          if (myGen !== genRef.current) return
          connect()
        }, RECONNECT_DELAY_MS)
      }
    }

    async function load(): Promise<void> {
      try {
        const acc: StoredEvent[] = []
        let after: number | undefined
        for (;;) {
          const page = await fetchEventsPage(sessionId, apiParams, after, PAGE_LIMIT)
          if (myGen !== genRef.current) return
          acc.push(...page.events)
          if (page.events.length > 0) {
            lastSeqRef.current = page.events[page.events.length - 1].seq
          }
          if (page.next_after_seq === null) break
          after = page.next_after_seq
        }
        if (myGen !== genRef.current) return
        setEvents(acc)
        setLoading(false)
        connect()
      } catch (err) {
        if (myGen !== genRef.current) return
        setError(errorMessage(err))
        setLoading(false)
      }
    }

    load()

    return () => {
      genRef.current++
      teardownStream()
    }
    // apiParams/pinSeqs are objects recreated every render by callers; the
    // stable primitives (apiParamsKey, sessionId, reloadToken) are the real
    // dependencies — see the eslint-disable rationale in comments above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, apiParamsKey, reloadToken])

  // Pin resolution: independent of filters/tail. Anything in `pinSeqs`
  // already present in `events` is reused as-is; anything missing is
  // fetched directly (the after_seq=seq-1&limit=1 trick from API.md) and
  // cached so later filter/tail changes don't re-fetch it.
  const pinCacheRef = useRef<Map<number, StoredEvent>>(new Map())
  const pinSeqsKey = pinSeqs.join(',')

  useEffect(() => {
    pinCacheRef.current = new Map()
  }, [sessionId])

  useEffect(() => {
    let cancelled = false

    async function resolvePins(): Promise<void> {
      const results: StoredEvent[] = []
      for (const seq of pinSeqs) {
        const cached = pinCacheRef.current.get(seq)
        if (cached) {
          results.push(cached)
          continue
        }
        const found = events.find((e) => e.seq === seq)
        if (found) {
          pinCacheRef.current.set(seq, found)
          results.push(found)
          continue
        }
        try {
          const page = await fetchEventsPage(sessionId, new URLSearchParams(), seq - 1, 1)
          if (cancelled) return
          const resolved = page.events[0]
          if (resolved) {
            pinCacheRef.current.set(seq, resolved)
            results.push(resolved)
          }
        } catch {
          // A single unresolved pin (e.g. deleted event) shouldn't break the rest.
        }
      }
      if (cancelled) return
      results.sort((a, b) => a.seq - b.seq)
      setPinned(results)
    }

    resolvePins()
    return () => {
      cancelled = true
    }
    // pinSeqsKey stands in for pinSeqs (new array identity every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pinSeqsKey, events])

  const pause = useCallback(() => {
    tailRef.current = 'paused'
    setTail('paused')
  }, [])

  const resume = useCallback(() => {
    tailRef.current = 'live'
    setTail('live')
    // Capture before clearing: setEvents' updater runs later (React
    // batches state updates), so reading pendingRef.current inside it would
    // see the just-cleared array instead of what we're flushing.
    const flushed = pendingRef.current
    pendingRef.current = []
    setEvents((prev) => [...prev, ...flushed])
    setPending([])
  }, [])

  const refetch = useCallback(() => {
    setReloadToken((t) => t + 1)
  }, [])

  return [
    { events, loading, tail, pendingCount: pending.length, pinned, error },
    { pause, resume, refetch },
  ]
}
