import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listSessions, getSession, fetchEventsPage, type SessionSummary, type StoredEvent } from '../api'
import { filtersToApiParams } from '../lib/filters'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const SESSION: SessionSummary = {
  id: 's1',
  label: null,
  first_ts: 0,
  last_ts: 1000,
  duration_ms: 1000,
  status: 'idle',
  event_count: 2,
  error_count: 0,
  warn_count: 0,
  sources: ['webapp'],
}

const EVENT: StoredEvent = {
  seq: 1,
  session_id: 's1',
  ts: 100,
  received_at: 100,
  source: 'webapp',
  ns: 'auth',
  level: 'info',
  msg: 'hi',
  ctx: null,
  trace: null,
}

describe('listSessions', () => {
  it('GETs /api/sessions and returns the parsed array', async () => {
    fetchMock.mockResolvedValue(jsonResponse([SESSION]))
    const result = await listSessions()
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions')
    expect(result).toEqual([SESSION])
  })
})

describe('getSession', () => {
  it('returns the session on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SESSION))
    const result = await getSession('s1')
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1')
    expect(result).toEqual(SESSION)
  })

  it('returns null on 404 instead of throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'session not found' }, 404))
    const result = await getSession('missing')
    expect(result).toBeNull()
  })

  it('url-encodes the session id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SESSION))
    await getSession('s 1/x')
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s%201%2Fx')
  })
})

describe('fetchEventsPage', () => {
  it('builds the exact query string: api params, then after_seq, then limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [EVENT], next_after_seq: 42 }))
    const params = filtersToApiParams({ ns: 'auth:*', level: 'error' })
    const result = await fetchEventsPage('s1', params, 10, 100)
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/events?ns=auth%3A*&level=error&after_seq=10&limit=100')
    expect(result).toEqual({ events: [EVENT], next_after_seq: 42 })
  })

  it('omits after_seq and limit when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], next_after_seq: null }))
    const params = filtersToApiParams({ q: 'boom' })
    await fetchEventsPage('s1', params)
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/events?q=boom')
  })

  it('does not mutate the URLSearchParams passed in', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], next_after_seq: null }))
    const params = filtersToApiParams({ ns: 'x' })
    await fetchEventsPage('s1', params, 5, 50)
    expect(params.toString()).toBe('ns=x')
  })

  it('omits the query string entirely when there are no params at all', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], next_after_seq: null }))
    await fetchEventsPage('s1', new URLSearchParams())
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/events')
  })
})
