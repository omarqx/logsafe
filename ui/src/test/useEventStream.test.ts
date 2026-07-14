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
    const { result, rerender } = renderHook(
      ({ params }: { params: URLSearchParams }) => useEventStream('s1', params, []),
      { initialProps: { params: new URLSearchParams({ level: 'info' }) } },
    )
    await act(async () => flush())
    expect(result.current[0].events.map((e) => e.seq)).toEqual([1])

    fetchMock.mockResolvedValueOnce(jsonResponse({ events: [ev({ seq: 9 })], next_after_seq: null }))
    rerender({ params: new URLSearchParams({ level: 'error' }) })
    await act(async () => flush())

    expect(result.current[0].events.map((e) => e.seq)).toEqual([9])
  })
})

describe('useEventStream: pins', () => {
  it('resolves pins already present in events without a fetch, and fetches missing ones via after_seq=seq-1&limit=1', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ events: [ev({ seq: 1 }), ev({ seq: 2 })], next_after_seq: null }),
    )
    const { result, rerender } = renderHook(
      ({ pins }: { pins: number[] }) => useEventStream('s1', new URLSearchParams(), pins),
      { initialProps: { pins: [1] } },
    )
    await act(async () => flush())
    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([1])

    // pin a seq that was filtered out of `events` entirely (never loaded)
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
    const { result } = renderHook(() => useEventStream('s1', new URLSearchParams(), [3, 1, 2]))
    await act(async () => flush())
    expect(result.current[0].pinned.map((e) => e.seq)).toEqual([1, 2, 3])
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
