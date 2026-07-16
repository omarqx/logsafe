import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listSessions,
  getSession,
  fetchEventsPage,
  deleteSession,
  purgeEvents,
  exportUrl,
  makePluginFetch,
  type SessionSummary,
  type StoredEvent,
} from '../api'
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

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => undefined,
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
  types: ['log'],
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
  type: 'log',
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

describe('deleteSession', () => {
  it('DELETEs /api/sessions/:id, url-encoded', async () => {
    fetchMock.mockResolvedValue(emptyResponse(204))
    await deleteSession('s 1')
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s%201', { method: 'DELETE' })
  })

  it('treats 404 as a no-op instead of throwing (already deleted)', async () => {
    fetchMock.mockResolvedValue(emptyResponse(404))
    await expect(deleteSession('missing')).resolves.toBeUndefined()
  })

  it('throws on other non-2xx statuses', async () => {
    fetchMock.mockResolvedValue(emptyResponse(500))
    await expect(deleteSession('s1')).rejects.toThrow('deleteSession failed: 500')
  })
})

describe('api additions', () => {
  it('builds an export url with params', () => {
    expect(exportUrl('s 1', new URLSearchParams({ level: 'error' }))).toBe('/api/sessions/s%201/export.ndjson?level=error')
  })

  it('scopes pluginFetch to the plugin namespace', async () => {
    const calls: string[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: 1 }) } }) as never
    const pf = makePluginFetch('psdk')
    await pf('/views/s1')
    globalThis.fetch = orig
    expect(calls[0]).toBe('/api/plugins/psdk/views/s1')
  })

  it('normalizes a pluginFetch path with no leading slash', async () => {
    const calls: string[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: 1 }) } }) as never
    const pf = makePluginFetch('psdk')
    await pf('views')
    globalThis.fetch = orig
    expect(calls[0]).toBe('/api/plugins/psdk/views')
  })

  it('returns a stable fetcher per plugin id (safe for useEffect deps)', () => {
    expect(makePluginFetch('psdk')).toBe(makePluginFetch('psdk'))
    expect(makePluginFetch('psdk')).not.toBe(makePluginFetch('other'))
  })
})

describe('purgeEvents', () => {
  it('DELETEs /api/sessions/:id/events?through_seq=N, url-encoded, and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: 3, session: SESSION }))
    const result = await purgeEvents('s 1', 42)
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s%201/events?through_seq=42', { method: 'DELETE' })
    expect(result).toEqual({ deleted: 3, session: SESSION })
  })

  it('returns session: null when the purge removed the whole session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: 5, session: null }))
    const result = await purgeEvents('s1', 100)
    expect(result).toEqual({ deleted: 5, session: null })
  })

  it('throws on non-2xx statuses (matches the file error style, no idempotent 404 handling)', async () => {
    fetchMock.mockResolvedValue(emptyResponse(404))
    await expect(purgeEvents('missing', 1)).rejects.toThrow('purgeEvents failed: 404')
  })

  it('throws on 400 (missing/non-finite through_seq server-side)', async () => {
    fetchMock.mockResolvedValue(emptyResponse(400))
    await expect(purgeEvents('s1', 1)).rejects.toThrow('purgeEvents failed: 400')
  })
})
