import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { Db } from './db.js'
import { normalizeEvent, type NormalizedEvent } from './normalize.js'
import { insertBatch, type StoredEvent } from './ingest.js'
import { queryEvents, listSessions, getSession, deleteSession, type EventFilters } from './queries.js'

export const MAX_BATCH = 1000
export const BODY_LIMIT = 5 * 1024 * 1024

export interface AppOptions {
  db: Db
  now?: () => number
}

function num(v: unknown): number | undefined {
  if (typeof v !== 'string' || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function parseFilters(q: Record<string, unknown>): EventFilters {
  return {
    ns: str(q.ns),
    level: str(q.level),
    source: str(q.source),
    trace: str(q.trace),
    q: str(q.q),
    from_ts: num(q.from_ts),
    to_ts: num(q.to_ts),
    after_seq: num(q.after_seq),
    before_seq: num(q.before_seq),
    limit: num(q.limit),
  }
}

export function buildApp({ db, now = Date.now }: AppOptions): FastifyInstance {
  const app = Fastify({ bodyLimit: BODY_LIMIT })

  app.register(cors, { origin: true })

  // navigator.sendBeacon can only send "simple" content types without a CORS
  // preflight it cannot perform, so the browser helper beacons text/plain.
  app.addContentTypeParser(['text/plain'], { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string))
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  app.post('/v1/log', (req, reply) => {
    const body = req.body
    const t = now()
    if (Array.isArray(body)) {
      if (body.length > MAX_BATCH) {
        return reply.code(413).send({ error: `batch exceeds ${MAX_BATCH} events` })
      }
      const good: NormalizedEvent[] = []
      for (const raw of body) {
        const ev = normalizeEvent(raw, t)
        if (ev) good.push(ev)
      }
      const stored = insertBatch(db, good)
      afterInsert(stored)
      return reply.code(202).send({ accepted: good.length, rejected: body.length - good.length })
    }
    const ev = normalizeEvent(body, t)
    if (!ev) {
      return reply.code(400).send({ error: 'event must be an object with a non-empty string msg' })
    }
    const stored = insertBatch(db, [ev])
    afterInsert(stored)
    return reply.code(202).send({ accepted: 1, rejected: 0 })
  })

  // Task 7 (SSE) replaces this no-op with hub.publish.
  let afterInsert: (events: StoredEvent[]) => void = () => {}
  const setAfterInsert = (fn: (events: StoredEvent[]) => void): void => {
    afterInsert = fn
  }
  void setAfterInsert // referenced by Task 7

  app.get('/api/health', () => ({ ok: true }))

  app.get('/api/sessions', (req) => {
    const q = req.query as Record<string, unknown>
    return listSessions(db, num(q.limit) ?? 50, num(q.offset) ?? 0, now())
  })

  app.get('/api/sessions/:id', (req, reply) => {
    const { id } = req.params as { id: string }
    const session = getSession(db, id, now())
    if (!session) return reply.code(404).send({ error: 'session not found' })
    return session
  })

  app.get('/api/sessions/:id/events', (req) => {
    const { id } = req.params as { id: string }
    return queryEvents(db, id, parseFilters(req.query as Record<string, unknown>))
  })

  app.get('/api/sessions/:id/export.ndjson', (req, reply) => {
    const { id } = req.params as { id: string }
    const filters = parseFilters(req.query as Record<string, unknown>)
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'access-control-allow-origin': '*',
    })
    let after = filters.after_seq
    for (;;) {
      const { events, next_after_seq } = queryEvents(db, id, { ...filters, after_seq: after, limit: 5000 })
      for (const ev of events) reply.raw.write(JSON.stringify(ev) + '\n')
      if (next_after_seq === null) break
      after = next_after_seq
    }
    reply.raw.end()
  })

  app.delete('/api/sessions/:id', (req, reply) => {
    const { id } = req.params as { id: string }
    if (!deleteSession(db, id)) return reply.code(404).send({ error: 'session not found' })
    return reply.code(204).send()
  })

  return app
}
