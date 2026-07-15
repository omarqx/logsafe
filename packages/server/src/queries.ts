import type { Db } from './db.js'
import type { Level } from './normalize.js'
import type { StoredEvent } from './ingest.js'

export interface EventFilters {
  ns?: string
  level?: string
  source?: string
  type?: string
  trace?: string
  q?: string
  from_ts?: number
  to_ts?: number
  after_seq?: number
  before_seq?: number
  limit?: number
}

export const DEFAULT_LIMIT = 500
export const MAX_LIMIT = 10_000

/** Translate a logsafe ns pattern (auth:*, player.*) to SQLite GLOB:
    our only wildcard is '*'; escape GLOB's other metacharacters. */
export function nsToGlob(pattern: string): string {
  return pattern.replace(/\[/g, '[[]').replace(/\?/g, '[?]')
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

function csv(v: string): string[] {
  return v.split(',').map((p) => p.trim()).filter((p) => p !== '')
}

interface EventRow {
  seq: number
  session_id: string
  ts: number
  received_at: number
  source: string
  ns: string
  level: Level
  msg: string
  ctx: string | null
  trace: string | null
  type: string
}

function rowToEvent(row: EventRow): StoredEvent {
  return { ...row, ctx: row.ctx === null ? null : JSON.parse(row.ctx) }
}

export function queryEvents(
  db: Db,
  sessionId: string,
  f: EventFilters,
): { events: StoredEvent[]; next_after_seq: number | null } {
  const where: string[] = ['session_id = ?']
  const params: unknown[] = [sessionId]

  if (f.ns) {
    const pats = csv(f.ns)
    if (pats.length > 0) {
      where.push(`(${pats.map(() => 'ns GLOB ?').join(' OR ')})`)
      params.push(...pats.map(nsToGlob))
    }
  }
  if (f.level) {
    const levels = csv(f.level)
    if (levels.length > 0) {
      where.push(`level IN (${levels.map(() => '?').join(',')})`)
      params.push(...levels)
    }
  }
  if (f.source) {
    const sourcesList = csv(f.source)
    if (sourcesList.length > 0) {
      where.push(`source IN (${sourcesList.map(() => '?').join(',')})`)
      params.push(...sourcesList)
    }
  }
  if (f.type) {
    const types = csv(f.type)
    if (types.length > 0) {
      where.push(`type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }
  }
  if (f.trace) {
    where.push('trace = ?')
    params.push(f.trace)
  }
  if (f.q) {
    where.push(`(msg LIKE ? ESCAPE '\\' OR ctx LIKE ? ESCAPE '\\')`)
    const p = `%${escapeLike(f.q)}%`
    params.push(p, p)
  }
  if (f.from_ts !== undefined) { where.push('ts >= ?'); params.push(f.from_ts) }
  if (f.to_ts !== undefined) { where.push('ts <= ?'); params.push(f.to_ts) }
  if (f.after_seq !== undefined) { where.push('seq > ?'); params.push(f.after_seq) }
  if (f.before_seq !== undefined) { where.push('seq < ?'); params.push(f.before_seq) }

  const limit = Math.min(Math.max(1, Math.trunc(f.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
  const rows = db
    .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`)
    .all(...params, limit) as EventRow[]

  return {
    events: rows.map(rowToEvent),
    next_after_seq: rows.length === limit ? rows[rows.length - 1].seq : null,
  }
}

export const ACTIVE_WINDOW_MS = 60_000

export interface SessionSummary {
  id: string
  label: string | null
  first_ts: number
  last_ts: number
  duration_ms: number
  status: 'active' | 'idle'
  event_count: number
  error_count: number
  warn_count: number
  sources: string[]
  types: string[]
}

interface SessionRow {
  id: string
  label: string | null
  first_ts: number
  last_ts: number
  event_count: number
  error_count: number
  warn_count: number
  sources: string
  types: string
}

function rowToSession(row: SessionRow, now: number): SessionSummary {
  return {
    id: row.id,
    label: row.label,
    first_ts: row.first_ts,
    last_ts: row.last_ts,
    duration_ms: row.last_ts - row.first_ts,
    status: now - row.last_ts <= ACTIVE_WINDOW_MS ? 'active' : 'idle',
    event_count: row.event_count,
    error_count: row.error_count,
    warn_count: row.warn_count,
    sources: JSON.parse(row.sources),
    types: JSON.parse(row.types),
  }
}

export function listSessions(db: Db, limit: number, offset: number, now: number): SessionSummary[] {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 1000)
  const safeOffset = Math.max(0, Math.trunc(offset))
  const rows = db
    .prepare('SELECT * FROM sessions ORDER BY last_ts DESC LIMIT ? OFFSET ?')
    .all(safeLimit, safeOffset) as SessionRow[]
  return rows.map((r) => rowToSession(r, now))
}

export function getSession(db: Db, id: string, now: number): SessionSummary | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  return row ? rowToSession(row, now) : null
}

export function deleteSession(db: Db, id: string, onDelete?: (sessionId: string) => void): boolean {
  const run = db.transaction((sid: string): boolean => {
    db.prepare('DELETE FROM events WHERE session_id = ?').run(sid)
    const res = db.prepare('DELETE FROM sessions WHERE id = ?').run(sid)
    if (res.changes > 0) onDelete?.(sid)
    return res.changes > 0
  })
  return run(id)
}
