// logsafe-plugin-http — server side. Claims http/http:* events, derives a
// per-request table (one row per trace), and serves summary + request-list
// routes for the UI's badge and timeline. Exercises every ServerPlugin hook.
import type { ServerPlugin, IncomingEvent, StoredEvent, ServerPluginContext } from '@coglet/logsafe-plugin-sdk/server'

export interface HttpRequestRow {
  session_id: string
  trace: string
  method: string | null
  path: string | null
  status: number | null
  latency_ms: number | null
  ts: number
}

const SLOW_MS = 1000

function requestCtx(ev: IncomingEvent | StoredEvent): Record<string, unknown> | null {
  const c = ev.ctx
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return null
  const r = c as Record<string, unknown>
  // A "request" event carries at least one of the request fields.
  if (r.method === undefined && r.path === undefined && r.status === undefined && r.latency_ms === undefined) return null
  return r
}

const plugin: ServerPlugin = {
  matchType: (e) => (e.ns === 'http' || e.ns.startsWith('http:') ? 'http' : null),

  transform: (e) => {
    const r = requestCtx(e)
    if (!r || typeof r.latency_ms !== 'number' || r.latency_ms <= SLOW_MS) return
    return { ...e, ctx: { ...r, slow: true } }
  },

  migrate: (ctx) => {
    ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('requests')} (
      session_id TEXT NOT NULL,
      trace      TEXT NOT NULL,
      method     TEXT,
      path       TEXT,
      status     INTEGER,
      latency_ms INTEGER,
      ts         INTEGER NOT NULL,
      PRIMARY KEY (session_id, trace)
    )`)
  },

  afterInsert: (events, ctx) => {
    const upsert = ctx.db.prepare(`
      INSERT INTO ${ctx.db.table('requests')} (session_id, trace, method, path, status, latency_ms, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, trace) DO UPDATE SET
        method = excluded.method, path = excluded.path, status = excluded.status,
        latency_ms = excluded.latency_ms, ts = excluded.ts
    `)
    for (const e of events) {
      const r = requestCtx(e)
      if (!r) continue // claimed but not a request event — flat log only
      upsert.run(
        e.session_id,
        e.trace ?? String(e.seq),
        typeof r.method === 'string' ? r.method : null,
        typeof r.path === 'string' ? r.path : null,
        typeof r.status === 'number' ? r.status : null,
        typeof r.latency_ms === 'number' ? r.latency_ms : null,
        e.ts,
      )
    }
  },

  routes: (router, ctx) => {
    router.get('/summary/:sessionId', (req) => {
      const agg = ctx.db.prepare(`
        SELECT count(*) AS request_count,
               coalesce(sum(status >= 500), 0) AS error_count,
               coalesce(avg(latency_ms), 0) AS avg_latency,
               coalesce(max(latency_ms), 0) AS max_latency_ms
        FROM ${ctx.db.table('requests')} WHERE session_id = ?
      `).get(req.params.sessionId) as { request_count: number; error_count: number; avg_latency: number; max_latency_ms: number }
      return {
        request_count: agg.request_count,
        error_count: agg.error_count,
        avg_latency_ms: Math.round(agg.avg_latency),
        max_latency_ms: agg.max_latency_ms,
      }
    })
    router.get('/requests/:sessionId', (req) => ({
      requests: ctx.db.prepare(
        `SELECT * FROM ${ctx.db.table('requests')} WHERE session_id = ? ORDER BY ts ASC`,
      ).all(req.params.sessionId) as HttpRequestRow[],
    }))
  },

  onSessionDelete: (sessionId, ctx: ServerPluginContext) => {
    ctx.db.prepare(`DELETE FROM ${ctx.db.table('requests')} WHERE session_id = ?`).run(sessionId)
  },
}

export default plugin
