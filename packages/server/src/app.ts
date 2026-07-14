import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { once } from 'node:events'
import type { Db } from './db.js'
import { normalizeEvent, type NormalizedEvent } from './normalize.js'
import { insertBatch, type StoredEvent } from './ingest.js'
import { queryEvents, listSessions, getSession, deleteSession, type EventFilters } from './queries.js'
import { SseHub } from './sse.js'

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

  const hub = new SseHub()
  const afterInsert = (events: StoredEvent[]): void => {
    const bySession = new Map<string, StoredEvent[]>()
    for (const ev of events) {
      const list = bySession.get(ev.session_id)
      if (list) list.push(ev)
      else bySession.set(ev.session_id, [ev])
    }
    for (const [sid, list] of bySession) hub.publish(sid, list)
  }

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

  app.get('/api/sessions/:id/export.ndjson', async (req, reply) => {
    const { id } = req.params as { id: string }
    const filters = parseFilters(req.query as Record<string, unknown>)
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'access-control-allow-origin': '*',
    })
    // A drain wait can suspend indefinitely; if the client disconnects while
    // suspended, the socket gets neither 'drain' nor 'error', stranding this
    // handler (and the up-to-5000-event page it's holding) forever. Abort
    // the wait on disconnect instead.
    const closed = new AbortController()
    req.raw.on('close', () => closed.abort())
    let after = filters.after_seq
    for (;;) {
      if (reply.raw.destroyed) break
      const { events, next_after_seq } = queryEvents(db, id, { ...filters, after_seq: after, limit: 5000 })
      for (const ev of events) {
        if (reply.raw.destroyed) break
        if (!reply.raw.write(JSON.stringify(ev) + '\n') && !reply.raw.destroyed) {
          try {
            await once(reply.raw, 'drain', { signal: closed.signal })
          } catch {
            break // client gone mid-wait; outer loop's destroyed check stops pagination
          }
        }
      }
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

  app.get('/api/sessions/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string }
    const q = req.query as Record<string, unknown>
    const afterSeq = num(q.after_seq) ?? 0

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    // Node buffers headers until the first body write; flush now so clients
    // (and this route's own tests) see the response immediately even when
    // there's nothing to replay yet.
    reply.raw.flushHeaders()

    // Live-path writes (this callback, the heartbeat) stay fire-and-forget:
    // they're event-driven and small, and a slow client is eventually
    // disconnected by its own reading pace. Only the replay loop below
    // awaits drain, since it can synchronously push an unbounded backlog.
    let lastSeq = afterSeq
    let replaying = true
    const pending: StoredEvent[] = []
    const write = (ev: StoredEvent): boolean => {
      if (ev.seq <= lastSeq) return true
      lastSeq = ev.seq
      return reply.raw.write(`event: log\ndata: ${JSON.stringify(ev)}\n\n`)
    }

    // While replay is paginating (and possibly suspended on 'drain'),
    // live events are buffered; writing them immediately would advance
    // lastSeq past the un-replayed backlog and silently drop it. Once
    // replay finishes, the buffer is flushed synchronously (below) and the
    // seq guard in write() dedupes anything replay already sent, so every
    // event is delivered exactly once regardless of how replay and live
    // publishes interleave.
    const unsubscribe = hub.subscribe(id, (events) => {
      if (replaying) {
        pending.push(...events)
        return
      }
      for (const ev of events) write(ev)
    })

    // Wire up cleanup before the replay loop (not after): the loop can now
    // await 'drain', so the client may disconnect mid-replay. Registering
    // the close handler first ensures the hub subscription and heartbeat
    // are always torn down instead of leaking on an early disconnect, and
    // aborts any in-flight drain wait so it can't strand this handler.
    const closed = new AbortController()
    const hb = setInterval(() => reply.raw.write(': hb\n\n'), 15_000)
    req.raw.on('close', () => {
      closed.abort()
      clearInterval(hb)
      unsubscribe()
    })

    let after = afterSeq
    for (;;) {
      if (reply.raw.destroyed) break
      const { events, next_after_seq } = queryEvents(db, id, { after_seq: after, limit: 5000 })
      for (const ev of events) {
        if (reply.raw.destroyed) break
        if (!write(ev) && !reply.raw.destroyed) {
          try {
            await once(reply.raw, 'drain', { signal: closed.signal })
          } catch {
            break // client gone mid-wait; outer loop's destroyed check stops pagination
          }
        }
      }
      if (next_after_seq === null) break
      after = next_after_seq
    }

    // Replay is done (or the client is gone). Flip the flag and flush
    // whatever live events queued up while replay was running, in the same
    // synchronous stretch so no hub callback can interleave and re-buffer.
    replaying = false
    for (const ev of pending) write(ev) // seq guard dedupes anything replay already sent
    pending.length = 0
  })

  return app
}
