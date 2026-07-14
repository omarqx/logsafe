import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0)

let app: FastifyInstance
beforeEach(async () => {
  app = buildApp({ db: openDb(':memory:'), now: () => NOW })
  await app.ready()
})

const post = (payload: unknown, contentType = 'application/json') =>
  app.inject({
    method: 'POST',
    url: '/v1/log',
    headers: { 'content-type': contentType },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })

describe('POST /v1/log', () => {
  it('accepts a single event with only msg', async () => {
    const res = await post({ msg: 'hello' })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
  })

  it('accepts a batch, skips bad events without failing the batch', async () => {
    const res = await post([{ msg: 'a', session_id: 's1' }, { nope: true }, { msg: 'b', session_id: 's1' }])
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 2, rejected: 1 })
  })

  it('rejects a single invalid event with 400', async () => {
    expect((await post({ nope: true })).statusCode).toBe(400)
    expect((await post('not json at all')).statusCode).toBe(400)
  })

  it('rejects oversize batches with 413', async () => {
    const batch = Array.from({ length: 1001 }, () => ({ msg: 'x' }))
    expect((await post(batch)).statusCode).toBe(413)
  })

  it('parses text/plain bodies as JSON (sendBeacon path)', async () => {
    const res = await post(JSON.stringify([{ msg: 'beacon', session_id: 's1' }]), 'text/plain')
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
  })

  it('parses bodies with any content type as JSON (bare curl -d)', async () => {
    const res = await post(JSON.stringify({ msg: 'bare curl', session_id: 's1' }), 'application/x-www-form-urlencoded')
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
  })

  it('parses bodies via the catch-all parser as JSON (unlisted content type)', async () => {
    const res = await post(JSON.stringify({ msg: 'octet stream', session_id: 's1' }), 'application/octet-stream')
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
  })

  it('malformed JSON through the catch-all parser returns 400, not 500', async () => {
    const res = await post('not json at all', 'application/octet-stream')
    expect(res.statusCode).toBe(400)
  })

  it('sends permissive CORS headers', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/log',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    })
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})

describe('query routes', () => {
  beforeEach(async () => {
    await post([
      { msg: 'token ok', session_id: 's1', source: 'api', ns: 'auth:token', level: 'debug', ts: NOW - 5000 },
      { msg: 'login failed', session_id: 's1', source: 'api', ns: 'auth:login', level: 'error', ts: NOW - 4000 },
      { msg: 'render', session_id: 's1', source: 'webapp', ns: 'player.render', level: 'info', ts: NOW - 3000, session_label: 'demo run' },
    ])
  })

  it('GET /api/health', async () => {
    const res = await app.inject('/api/health')
    expect(res.json()).toEqual({ ok: true })
  })

  it('GET /api/sessions returns summaries', async () => {
    const res = await app.inject('/api/sessions')
    const sessions = res.json()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: 's1',
      label: 'demo run',
      event_count: 3,
      error_count: 1,
      status: 'active',
      sources: ['api', 'webapp'],
    })
  })

  it('GET /api/sessions/:id and 404', async () => {
    expect((await app.inject('/api/sessions/s1')).json().id).toBe('s1')
    expect((await app.inject('/api/sessions/nope')).statusCode).toBe(404)
  })

  it('GET /api/sessions/:id/events applies filters from query string', async () => {
    const res = await app.inject('/api/sessions/s1/events?ns=auth:*&level=error')
    const body = res.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0].msg).toBe('login failed')
    expect(body.next_after_seq).toBeNull()
  })

  it('GET export.ndjson streams one JSON object per line', async () => {
    const res = await app.inject('/api/sessions/s1/export.ndjson')
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    const lines = res.body.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(3)
    expect(lines[0].seq).toBe(1)
  })

  it('DELETE /api/sessions/:id', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })).statusCode).toBe(204)
    expect((await app.inject('/api/sessions/s1')).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })).statusCode).toBe(404)
  })
})
