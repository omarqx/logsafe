// @vitest-environment jsdom
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEventStream, _setEventSourceFactoryForTests } from '../hooks/useEventStream'
import type { StoredEvent } from '../api'

// --- Fake EventSource, fully controlled by the test -----------------------

type Listener = (ev: { data: string }) => void

class FakeEventSource {
  url: string
  closed = false
  onerror: ((ev: Event) => void) | null = null
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    instances.push(this)
  }

  addEventListener(type: string, handler: Listener): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(handler)
    this.listeners.set(type, arr)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, data: unknown): void {
    for (const h of this.listeners.get(type) ?? []) h({ data: JSON.stringify(data) })
  }

  triggerError(): void {
    this.onerror?.(new Event('error'))
  }
}

let instances: FakeEventSource[] = []

// --- fetch mock -------------------------------------------------------------

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

async function flush(times = 50): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

function ev(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    seq: 1,
    session_id: 's1',
    ts: 100,
    received_at: 100,
    source: 'webapp',
    ns: 'auth:token',
    level: 'info',
    msg: 'hi',
    ctx: null,
    trace: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  instances = []
  _setEventSourceFactoryForTests((url: string) => new FakeEventSource(url) as unknown as EventSource)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useEventStream: progressive load', () => {
  it('pages through fetchEventsPage with limit=10000 until next_after_seq is null, accumulating in order', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 }), ev({ seq: 2 })], next_after_seq: 2 }))
      .mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 3 })], next_after_seq: null }))

    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    expect(result.current[0].loading).toBe(true)

    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1, 2, 3])

    // both pages requested with limit=10000, second page picking up after_seq from the first
    const eventUrls = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/events'))
    expect(eventUrls[0]).toBe('/api/sessions/s1/events?limit=10000')
    expect(eventUrls[1]).toBe('/api/sessions/s1/events?after_seq=2&limit=10000')

    // stream opens from the last loaded seq
    expect(instances).toHaveLength(1)
    expect(instances[0].url).toBe('/api/sessions/s1/stream?after_seq=3')
  })

  it('sets error and stops (no stream opened) when the initial load fails; loading is not stuck true', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(result.current[0].error).toBe('boom')
    expect(instances).toHaveLength(0)
  })
})

describe('useEventStream: filtered SSE tail', () => {
  it('appends matching live events; drops non-matching but they still advance the resume cursor used on reconnect', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    // A filter is active, so load() also probes getSession (see the
    // "bounded SSE replay" describe block below) — 404 it so the probe is
    // skipped and this test's own fetch-call assertions stay untouched.
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404))

    const apiParams = new URLSearchParams({ ns: 'auth:*' })
    const { result } = renderHook(() => useEventStream('s1', apiParams, []))
    await act(async () => flush())

    expect(instances).toHaveLength(1)
    const es = instances[0]

    act(() => {
      es.emit('log', ev({ seq: 2, ns: 'auth:login', msg: 'matches' }))
    })
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1, 2])

    act(() => {
      es.emit('log', ev({ seq: 3, ns: 'payment.charge', msg: 'does not match ns filter' }))
    })
    // dropped: not appended
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1, 2])

    // but the cursor advanced past seq 3 — proven by the reconnect URL after an error
    act(() => {
      es.triggerError()
    })
    await act(async () => vi.advanceTimersByTime(1000))
    expect(instances).toHaveLength(2)
    expect(instances[1].url).toBe('/api/sessions/s1/stream?after_seq=3')
  })
})

describe('useEventStream: pause/resume', () => {
  it('buffers live events into pendingCount while paused, then flushes them into events on resume', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    await act(async () => flush())

    act(() => result.current[1].pause())
    expect(result.current[0].tail).toBe('paused')

    const es = instances[0]
    act(() => es.emit('log', ev({ seq: 2 })))
    act(() => es.emit('log', ev({ seq: 3 })))

    expect(result.current[0].pendingCount).toBe(2)
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1]) // not appended yet

    act(() => result.current[1].resume())
    expect(result.current[0].tail).toBe('live')
    expect(result.current[0].pendingCount).toBe(0)
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1, 2, 3])
  })
})

describe('useEventStream: refetch on filter change', () => {
  it('tears down the old EventSource, clears state, and reloads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    await act(async () => flush())

    expect(result.current[0].events.map((e) => e.seq)).toEqual([1])
    const firstEs = instances[0]

    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 5 })], next_after_seq: null }))
    act(() => result.current[1].refetch())

    // reset is synchronous within the effect
    expect(result.current[0].loading).toBe(true)
    expect(result.current[0].events).toEqual([])
    expect(firstEs.closed).toBe(true)

    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(result.current[0].events.map((e) => e.seq)).toEqual([5])
    expect(instances).toHaveLength(2)
    expect(instances[1].url).toBe('/api/sessions/s1/stream?after_seq=5')
  })

  it('reloads automatically when apiParams content changes between renders', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    // A filter is active both times below, so each load() also probes
    // getSession — 404 it so the probe is skipped (see the "bounded SSE
    // replay" describe block below for that behavior's own tests).
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404))
    const { result, rerender } = renderHook(
      ({ params }: { params: URLSearchParams }) => useEventStream('s1', params, []),
      { initialProps: { params: new URLSearchParams({ level: 'info' }) } },
    )
    await act(async () => flush())
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1])

    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 9 })], next_after_seq: null }))
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404))
    rerender({ params: new URLSearchParams({ level: 'error' }) })
    await act(async () => flush())

    expect(result.current[0].events.map((e) => e.seq)).toEqual([9])
  })
})

describe('useEventStream: pins', () => {
  // The pin-resolution effect intentionally depends on [sessionId, pinSeqsKey]
  // only (not `events` — see the comment in useEventStream.ts), so it only
  // consults eventsRef for "already loaded" pins at the moment pinSeqsKey
  // changes. These tests add pins via rerender *after* the initial load has
  // settled, so the already-loaded fast path is actually exercised.

  it('resolves a pin already present in events without an extra fetch, and fetches missing ones via after_seq=seq-1&limit=1', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ events: [ev({ seq: 1 }), ev({ seq: 2 })], next_after_seq: null }),
    )
    const { result, rerender } = renderHook(
      ({ pins }: { pins: number[] }) => useEventStream('s1', new URLSearchParams(), pins),
      { initialProps: { pins: [] as number[] } },
    )
    await act(async () => flush())
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1, 2])

    const callsBeforePin = fetchMock.mock.calls.length
    rerender({ pins: [1] })
    await act(async () => flush())

    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([1])
    // seq 1 was already loaded into eventsRef by the initial page — reused
    // from there, no extra network round trip.
    expect(fetchMock.mock.calls.length).toBe(callsBeforePin)

    // pin a seq that was never loaded — must be fetched directly
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 42 })], next_after_seq: null }))
    rerender({ pins: [1, 42] })
    await act(async () => flush())

    const pinCall = fetchMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes('after_seq=41'))
    expect(pinCall).toBe('/api/sessions/s1/events?after_seq=41&limit=1')
    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([1, 42])
  })

  it('sorts pinned by seq regardless of pinSeqs order', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ events: [ev({ seq: 1 }), ev({ seq: 2 }), ev({ seq: 3 })], next_after_seq: null }),
    )
    const { result, rerender } = renderHook(
      ({ pins }: { pins: number[] }) => useEventStream('s1', new URLSearchParams(), pins),
      { initialProps: { pins: [] as number[] } },
    )
    await act(async () => flush())

    rerender({ pins: [3, 1, 2] })
    await act(async () => flush())
    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('does not thrash the pin fetch: fetchEventsPage for an unresolved pin is called exactly once despite 5 tail events arriving', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    // The direct pin fetch (after_seq=98&limit=1) never settles during this
    // test — it stands in for "still in flight" while tail events arrive.
    let resolvePinFetch: (v: Response) => void = () => {}
    const pinFetchPromise = new Promise<Response>((resolve) => {
      resolvePinFetch = resolve
    })
    fetchMock.mockImplementationOnce(() => pinFetchPromise)

    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), [99]))
    await act(async () => flush())

    expect(instances).toHaveLength(1)
    const es = instances[0]
    for (let i = 0; i < 5; i++) {
      act(() => es.emit('log', ev({ seq: 2 + i })))
    }
    await act(async () => flush())

    const pinCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes('after_seq=98'))
    expect(pinCalls).toHaveLength(1)
    // the tail events themselves still landed normally, unaffected by the pending pin fetch
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6])

    resolvePinFetch(jsonResponse({ events: [ev({ seq: 99 })], next_after_seq: null }))
    await act(async () => flush())
    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([99])
  })

  it('discards an in-flight pin fetch result once refetch() bumps the generation before it resolves', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    let resolvePinFetch: (v: Response) => void = () => {}
    const pinFetchPromise = new Promise<Response>((resolve) => {
      resolvePinFetch = resolve
    })
    fetchMock.mockImplementationOnce(() => pinFetchPromise)

    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), [99]))
    await act(async () => flush())
    expect(result.current[0].pinned).toEqual([])

    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 5 })], next_after_seq: null }))
    act(() => result.current[1].refetch())
    await act(async () => flush())

    // the stale pin fetch (from before refetch) resolves only now
    resolvePinFetch(jsonResponse({ events: [ev({ seq: 99 })], next_after_seq: null }))
    await act(async () => flush())

    expect(result.current[0].pinned).toEqual([])
  })

  it('drops a stale pin resolution when the pin set changes while a fetch is in flight (unpin race)', async () => {
    // Reproduces the critical bug: mount with pins=[99] (fetch in flight),
    // then unpin before it resolves — the old run's fetch must not
    // resurrect the removed pin when it finally settles.
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    let resolvePinFetch: (v: Response) => void = () => {}
    const pinFetchPromise = new Promise<Response>((resolve) => {
      resolvePinFetch = resolve
    })
    fetchMock.mockImplementationOnce(() => pinFetchPromise)

    const { result, rerender } = renderHook(
      ({ pins }: { pins: number[] }) => useEventStream('s1', new URLSearchParams(), pins),
      { initialProps: { pins: [99] as number[] } },
    )
    await act(async () => flush())
    expect(result.current[0].pinned).toEqual([])

    // Unpin before the in-flight fetch for seq 99 resolves.
    rerender({ pins: [] })
    await act(async () => flush())
    expect(result.current[0].pinned).toEqual([])

    // The stale run's fetch resolves after the unpin — must not resurrect the pin.
    resolvePinFetch(jsonResponse({ events: [ev({ seq: 99 })], next_after_seq: null }))
    await act(async () => flush())
    expect(result.current[0].pinned).toEqual([])
  })

  it('leaves a pin unresolved when after_seq=seq-1&limit=1 resolves to a different (higher) seq — e.g. the requested event was deleted or the session was recreated with a gap', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    const { result, rerender } = renderHook(
      ({ pins }: { pins: number[] }) => useEventStream('s1', new URLSearchParams(), pins),
      { initialProps: { pins: [] as number[] } },
    )
    await act(async () => flush())

    // Pin seq 50, which was never loaded — the direct fetch (after_seq=49)
    // comes back with a *different*, higher-seq event (50 doesn't exist).
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 73 })], next_after_seq: null }))
    rerender({ pins: [50] })
    await act(async () => flush())

    expect(result.current[0].pinned).toEqual([])
  })

  it('resolves correctly when the pin set grows while an earlier pin fetch is still in flight', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    let resolveStalePinFetch: (v: Response) => void = () => {}
    const stalePinFetchPromise = new Promise<Response>((resolve) => {
      resolveStalePinFetch = resolve
    })
    fetchMock.mockImplementationOnce(() => stalePinFetchPromise)

    const { result, rerender } = renderHook(
      ({ pins }: { pins: number[] }) => useEventStream('s1', new URLSearchParams(), pins),
      { initialProps: { pins: [99] as number[] } },
    )
    await act(async () => flush())
    expect(result.current[0].pinned).toEqual([])

    // Grow the pin set to [99, 100] while 99's original fetch is still in flight.
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 99 })], next_after_seq: null }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 100 })], next_after_seq: null }))
    rerender({ pins: [99, 100] })
    await act(async () => flush())

    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([99, 100])

    // The stale run's fetch for 99 resolves after the newer run already
    // fetched both 99 and 100 fresh — it must not append a duplicate.
    resolveStalePinFetch(jsonResponse({ events: [ev({ seq: 99 })], next_after_seq: null }))
    await act(async () => flush())

    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([99, 100])
  })
})

describe('useEventStream: bounded SSE replay for sparse/empty filtered loads', () => {
  it('probes the session tail and fast-forwards the resume cursor when a filter matches nothing', async () => {
    // Filtered load matches 0 events — lastSeqRef would otherwise stay 0.
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [], next_after_seq: null }))
    // getSession(id) — the probe's source of the session's own last_ts.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 's1',
        label: null,
        first_ts: 0,
        last_ts: 999,
        duration_ms: 999,
        status: 'idle',
        event_count: 100_000,
        error_count: 0,
        warn_count: 0,
        sources: ['webapp'],
      }),
    )
    // The one unfiltered probe request: first event at from_ts=last_ts.
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 100_000 })], next_after_seq: null }))

    const apiParams = new URLSearchParams({ ns: 'nothing-matches:*' })
    const { result } = renderHook(() => useEventStream('s1', apiParams, []))
    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(result.current[0].events).toEqual([])
    expect(instances).toHaveLength(1)
    expect(instances[0].url).toBe('/api/sessions/s1/stream?after_seq=100000')

    const probeCall = fetchMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes('from_ts'))
    expect(probeCall).toBe('/api/sessions/s1/events?from_ts=999&limit=1')
  })

  it('does not probe when no filter is active', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [], next_after_seq: null }))
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    // Only the one page-load call — no getSession, no probe.
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(instances).toHaveLength(1)
    expect(instances[0].url).toBe('/api/sessions/s1/stream?after_seq=0')
  })
})

describe('useEventStream: floorSeq (non-destructive clear)', () => {
  it('uses floorSeq as the FIRST fetchEventsPage after_seq, and as the stream resume cursor when no events are past it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [], next_after_seq: null }))

    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), [], 500))
    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(result.current[0].events).toEqual([])
    const eventUrls = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/events'))
    expect(eventUrls[0]).toBe('/api/sessions/s1/events?after_seq=500&limit=10000')

    // no events past the floor were loaded, so the tail resumes from the
    // floor itself, not 0.
    expect(instances).toHaveLength(1)
    expect(instances[0].url).toBe('/api/sessions/s1/stream?after_seq=500')
  })

  it('advances the resume cursor past the floor once matching events are loaded', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ events: [ev({ seq: 501 }), ev({ seq: 502 })], next_after_seq: null }),
    )
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), [], 500))
    await act(async () => flush())

    expect(result.current[0].events.map((e) => e.seq)).toEqual([501, 502])
    expect(instances[0].url).toBe('/api/sessions/s1/stream?after_seq=502')
  })

  it('a floor change tears down the old EventSource, clears state, and reloads with the new after_seq (same as a filter change)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 501 })], next_after_seq: null }))
    const { result, rerender } = renderHook(
      ({ floorSeq }: { floorSeq: number }) => useEventStream('s1', new URLSearchParams(), [], floorSeq),
      { initialProps: { floorSeq: 500 } },
    )
    await act(async () => flush())
    expect(result.current[0].events.map((e) => e.seq)).toEqual([501])
    const firstEs = instances[0]

    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 901 })], next_after_seq: null }))
    rerender({ floorSeq: 900 })

    // reset is synchronous within the effect, same as refetch()/apiParams change
    expect(result.current[0].loading).toBe(true)
    expect(result.current[0].events).toEqual([])
    expect(firstEs.closed).toBe(true)

    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(result.current[0].events.map((e) => e.seq)).toEqual([901])
    const eventUrls = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/events'))
    expect(eventUrls.at(-1)).toBe('/api/sessions/s1/events?after_seq=900&limit=10000')
    expect(instances).toHaveLength(2)
    expect(instances[1].url).toBe('/api/sessions/s1/stream?after_seq=901')
  })

  it('composes with the sparse-filter probe: cursor becomes max(floor, matched, probed)', async () => {
    // Filtered load matches nothing past the floor.
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [], next_after_seq: null }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 's1',
        label: null,
        first_ts: 0,
        last_ts: 999,
        duration_ms: 999,
        status: 'idle',
        event_count: 100_000,
        error_count: 0,
        warn_count: 0,
        sources: ['webapp'],
      }),
    )
    // Probe returns a seq lower than the floor — floor must win.
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 200 })], next_after_seq: null }))

    const apiParams = new URLSearchParams({ ns: 'nothing-matches:*' })
    const { result } = renderHook(() => useEventStream('s1', apiParams, [], 500))
    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(instances[0].url).toBe('/api/sessions/s1/stream?after_seq=500')
  })

  it('does not affect pin resolution: a pin below the floor still resolves via its own absolute-seq fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [], next_after_seq: null }))
    const { result, rerender } = renderHook(
      ({ pins }: { pins: number[] }) => useEventStream('s1', new URLSearchParams(), pins, 500),
      { initialProps: { pins: [] as number[] } },
    )
    await act(async () => flush())
    expect(result.current[0].events).toEqual([])

    // Pin seq 42, well below the floor (500) — must still be fetched and resolved.
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 42 })], next_after_seq: null }))
    rerender({ pins: [42] })
    await act(async () => flush())

    const pinCall = fetchMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes('after_seq=41'))
    expect(pinCall).toBe('/api/sessions/s1/events?after_seq=41&limit=1')
    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([42])
  })
})

describe('useEventStream: SSE reconnect', () => {
  it('on error, closes and reopens after 1s using the latest seq cursor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    await act(async () => flush())

    const es = instances[0]
    act(() => es.triggerError())
    expect(es.closed).toBe(true)
    expect(instances).toHaveLength(1) // not yet reconnected

    await act(async () => vi.advanceTimersByTime(999))
    expect(instances).toHaveLength(1) // still not yet

    await act(async () => vi.advanceTimersByTime(1))
    expect(instances).toHaveLength(2)
    expect(instances[1].url).toBe('/api/sessions/s1/stream?after_seq=1')
  })

  it('does not set `error` for a tail reconnect — error is reserved for initial-load failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    await act(async () => flush())

    act(() => instances[0].triggerError())
    await act(async () => vi.advanceTimersByTime(1000))

    expect(result.current[0].error).toBeNull()
  })
})

describe('useEventStream: React.StrictMode (dev double-invoke)', () => {
  it('the real app renders inside StrictMode; the generation guard must survive its double-mount', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), []), {
      wrapper: StrictMode,
    })
    await act(async () => flush())

    expect(result.current[0].loading).toBe(false)
    expect(result.current[0].error).toBeNull()
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1])
    // exactly one *live* EventSource survives the mount→unmount→mount cycle
    const open = instances.filter((i) => !i.closed)
    expect(open).toHaveLength(1)
  })
})

describe('useEventStream: unmount cleanup', () => {
  it('closes the EventSource and stops applying further updates after unmount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 1 })], next_after_seq: null }))
    const { result, unmount } = renderHook(() => useEventStream('s1', new URLSearchParams(), []))
    await act(async () => flush())

    const es = instances[0]
    const snapshotBeforeUnmount = result.current[0].events

    unmount()
    expect(es.closed).toBe(true)

    // emitting after unmount must not throw, and a pending reconnect timer must not fire
    act(() => es.emit('log', ev({ seq: 2 })))
    await act(async () => vi.advanceTimersByTime(5000))

    expect(instances).toHaveLength(1) // no reconnect happened post-unmount
    expect(result.current[0].events).toBe(snapshotBeforeUnmount) // no state churn after unmount
  })
})
