// logsafe-plugin-jobs — server side. Claims job/job:* lifecycle events and
// derives a per-run row (stateful: start -> running, done/failed -> final),
// keyed (session_id, job_id) so replays and out-of-order finals are safe.
import type { ServerPlugin, StoredEvent } from '@coglet/logsafe-plugin-sdk/server'

export interface JobRun {
  session_id: string
  job_id: string
  name: string | null
  status: 'running' | 'done' | 'failed'
  duration_ms: number | null
  ts: number
}

function lifecycle(e: StoredEvent): { job_id: string; name: string | null; event: string; duration_ms: number | null } | null {
  const c = e.ctx
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return null
  const r = c as Record<string, unknown>
  if (typeof r.job_id !== 'string' || typeof r.event !== 'string') return null
  return {
    job_id: r.job_id,
    name: typeof r.name === 'string' ? r.name : null,
    event: r.event,
    duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : null,
  }
}

const plugin: ServerPlugin = {
  matchType: (e) => (e.ns === 'job' || e.ns.startsWith('job:') ? 'job' : null),

  migrate: (ctx) => {
    ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('runs')} (
      session_id  TEXT NOT NULL,
      job_id      TEXT NOT NULL,
      name        TEXT,
      status      TEXT NOT NULL,
      duration_ms INTEGER,
      ts          INTEGER NOT NULL,
      PRIMARY KEY (session_id, job_id)
    )`)
  },

  afterInsert: (events, ctx) => {
    // A start must never overwrite a final status (replay-safe); it only
    // creates the running row or fills a missing name.
    const start = ctx.db.prepare(`
      INSERT INTO ${ctx.db.table('runs')} (session_id, job_id, name, status, duration_ms, ts)
      VALUES (?, ?, ?, 'running', NULL, ?)
      ON CONFLICT(session_id, job_id) DO UPDATE SET name = coalesce(name, excluded.name)
    `)
    // A final creates-or-finalizes regardless of whether start was seen.
    const final = ctx.db.prepare(`
      INSERT INTO ${ctx.db.table('runs')} (session_id, job_id, name, status, duration_ms, ts)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, job_id) DO UPDATE SET
        status = excluded.status, duration_ms = excluded.duration_ms,
        ts = excluded.ts, name = coalesce(excluded.name, name)
    `)
    for (const e of events) {
      const l = lifecycle(e)
      if (!l) continue
      if (l.event === 'start') start.run(e.session_id, l.job_id, l.name, e.ts)
      else if (l.event === 'done' || l.event === 'failed') {
        final.run(e.session_id, l.job_id, l.name, l.event, l.duration_ms, e.ts)
      }
    }
  },

  routes: (router, ctx) => {
    router.get('/summary/:sessionId', (req) => {
      const agg = ctx.db.prepare(`
        SELECT
          coalesce(sum(status != 'running'), 0)            AS processed,
          coalesce(sum(status = 'running'), 0)             AS running,
          coalesce(sum(status = 'failed'), 0)              AS failed,
          coalesce(avg(CASE WHEN status != 'running' THEN duration_ms END), 0) AS avg_dur,
          coalesce(max(CASE WHEN status != 'running' THEN duration_ms END), 0) AS max_dur
        FROM ${ctx.db.table('runs')} WHERE session_id = ?
      `).get(req.params.sessionId) as { processed: number; running: number; failed: number; avg_dur: number; max_dur: number }
      return {
        processed: agg.processed,
        running: agg.running,
        failed: agg.failed,
        failure_rate_pct: agg.processed === 0 ? 0 : Math.round((agg.failed / agg.processed) * 100),
        avg_duration_ms: Math.round(agg.avg_dur),
        max_duration_ms: agg.max_dur,
      }
    })
    router.get('/durations/:sessionId', (req) => ({
      runs: ctx.db.prepare(
        `SELECT * FROM ${ctx.db.table('runs')} WHERE session_id = ? AND status != 'running' ORDER BY ts ASC`,
      ).all(req.params.sessionId) as JobRun[],
    }))
  },

  onSessionDelete: (sessionId, ctx) => {
    ctx.db.prepare(`DELETE FROM ${ctx.db.table('runs')} WHERE session_id = ?`).run(sessionId)
  },
}

export default plugin
