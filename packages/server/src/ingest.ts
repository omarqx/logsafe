import type { Db } from './db.js'
import type { Level, NormalizedEvent } from './normalize.js'

export interface StoredEvent {
  seq: number
  session_id: string
  ts: number
  received_at: number
  source: string
  ns: string
  level: Level
  msg: string
  ctx: unknown
  trace: string | null
}

export function insertBatch(db: Db, events: NormalizedEvent[]): StoredEvent[] {
  if (events.length === 0) return []

  const insertEvent = db.prepare(`
    INSERT INTO events (session_id, ts, received_at, source, ns, level, msg, ctx, trace)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const ensureSession = db.prepare(`
    INSERT INTO sessions (id, first_ts, last_ts) VALUES (?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `)
  const getSession = db.prepare('SELECT sources FROM sessions WHERE id = ?')
  const updateSession = db.prepare(`
    UPDATE sessions SET
      label = coalesce(?, label),
      first_ts = min(first_ts, ?),
      last_ts = max(last_ts, ?),
      event_count = event_count + ?,
      error_count = error_count + ?,
      warn_count = warn_count + ?,
      sources = ?
    WHERE id = ?
  `)

  const run = db.transaction((evs: NormalizedEvent[]): StoredEvent[] => {
    const stored: StoredEvent[] = []
    const bySession = new Map<string, NormalizedEvent[]>()
    for (const e of evs) {
      const list = bySession.get(e.session_id)
      if (list) list.push(e)
      else bySession.set(e.session_id, [e])
    }

    for (const [sessionId, list] of bySession) {
      ensureSession.run(sessionId, list[0].ts, list[0].ts)
      const row = getSession.get(sessionId) as { sources: string }
      const sources = new Set<string>(JSON.parse(row.sources))

      let label: string | null = null
      let minTs = Infinity
      let maxTs = -Infinity
      let errors = 0
      let warns = 0

      for (const e of list) {
        sources.add(e.source)
        if (e.session_label !== null) label = e.session_label
        if (e.level === 'error') errors++
        if (e.level === 'warn') warns++
        if (e.ts < minTs) minTs = e.ts
        if (e.ts > maxTs) maxTs = e.ts
        const res = insertEvent.run(e.session_id, e.ts, e.received_at, e.source, e.ns, e.level, e.msg, e.ctx, e.trace)
        stored.push({
          seq: Number(res.lastInsertRowid),
          session_id: e.session_id,
          ts: e.ts,
          received_at: e.received_at,
          source: e.source,
          ns: e.ns,
          level: e.level,
          msg: e.msg,
          ctx: e.ctx === null ? null : JSON.parse(e.ctx),
          trace: e.trace,
        })
      }

      updateSession.run(label, minTs, maxTs, list.length, errors, warns, JSON.stringify([...sources].sort()), sessionId)
    }
    return stored
  })

  return run(events)
}
