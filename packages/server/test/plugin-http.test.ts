import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { makePluginContext } from '../src/plugins/context.js'
import type { LoadedServerPlugin } from '../src/plugins/loader.js'
import httpPlugin from '../../../examples/plugin-http/server.js'

const MANIFEST = { id: 'http', version: '0.1.0', apiVersion: '1', ownedTypes: ['http'], priority: 5 }

function loaded(db: Db): LoadedServerPlugin {
  const ctx = makePluginContext(db, 'http')
  httpPlugin.migrate?.(ctx)
  return { manifest: MANIFEST, plugin: httpPlugin, ctx }
}

const BATCH = [
  { msg: 'GET /',      session_id: 's1', source: 'web', ns: 'http',      trace: 't1', ts: 1000, ctx: { method: 'GET',  path: '/',    status: 200, latency_ms: 120 } },
  { msg: 'POST /vote', session_id: 's1', source: 'web', ns: 'http:vote', trace: 't2', ts: 2000, ctx: { method: 'POST', path: '/vote', status: 200, latency_ms: 1500 } },
  { msg: 'POST /vote', session_id: 's1', source: 'web', ns: 'http:vote', trace: 't3', ts: 3000, ctx: { method: 'POST', path: '/vote', status: 500, latency_ms: 88 } },
  { msg: 'app log',    session_id: 's1', source: 'web', ns: 'app',       ts: 3500 },              // generic — not claimed
  { msg: 'no ctx',     session_id: 's1', source: 'web', ns: 'http:misc', trace: 't4', ts: 4000 }, // claimed, no request fields
]

describe('plugin-http server', () => {
  let db: Db
  let app: ReturnType<typeof buildApp>
  beforeEach(async () => {
    db = openDb(':memory:')
    app = buildApp({ db, plugins: [loaded(db)] })
    await app.inject({ method: 'POST', url: '/v1/log', payload: BATCH })
  })

  it('claims http:* events and transforms slow ones', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/s1/events' })
    const events = res.json().events as { ns: string; type: string; ctx: Record<string, unknown> | null }[]
    const byNs = Object.fromEntries(events.map((e) => [e.ns, e]))
    expect(byNs['http'].type).toBe('http')
    expect(byNs['app'].type).toBe('generic')
    expect(byNs['http:vote'].type).toBe('http')
    const slow = events.find((e) => (e.ctx as { latency_ms?: number } | null)?.latency_ms === 1500)!
    expect((slow.ctx as { slow?: boolean }).slow).toBe(true)
    const fast = events.find((e) => (e.ctx as { latency_ms?: number } | null)?.latency_ms === 120)!
    expect((fast.ctx as { slow?: boolean }).slow).toBeUndefined()
  })

  it('upserts request rows (only events with request ctx) and serves /requests ordered', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/http/requests/s1' })
    const { requests } = res.json() as { requests: { trace: string; ts: number; status: number | null }[] }
    expect(requests.map((r) => r.trace)).toEqual(['t1', 't2', 't3']) // ts ASC; t4 had no request fields
  })

  it('re-ingesting the same trace updates, not duplicates', async () => {
    await app.inject({ method: 'POST', url: '/v1/log', payload: [
      { msg: 'GET / retry', session_id: 's1', source: 'web', ns: 'http', trace: 't1', ts: 1000, ctx: { method: 'GET', path: '/', status: 503, latency_ms: 300 } },
    ] })
    const res = await app.inject({ method: 'GET', url: '/api/plugins/http/requests/s1' })
    const { requests } = res.json() as { requests: { trace: string; status: number }[] }
    expect(requests.filter((r) => r.trace === 't1')).toHaveLength(1)
    expect(requests.find((r) => r.trace === 't1')!.status).toBe(503)
  })

  it('serves aggregate /summary (error = status >= 500)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/http/summary/s1' })
    expect(res.json()).toEqual({
      request_count: 3,
      error_count: 1,
      avg_latency_ms: Math.round((120 + 1500 + 88) / 3),
      max_latency_ms: 1500,
    })
  })

  it('cleans its rows on session delete', async () => {
    await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })
    const c = db.prepare('SELECT COUNT(*) c FROM plugin_http_requests').get() as { c: number }
    expect(c.c).toBe(0)
  })
})
