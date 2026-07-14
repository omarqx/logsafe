import type { Db } from './db.js'
import type { Level } from './normalize.js'
import type { StoredEvent } from './ingest.js'

export interface EventFilters {
  ns?: string
  level?: string
  source?: string
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

/** Translate a deblog ns pattern (auth:*, player.*) to SQLite GLOB:
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

  const limit = Math.min(Math.max(1, f.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const rows = db
    .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`)
    .all(...params, limit) as EventRow[]

  return {
    events: rows.map(rowToEvent),
    next_after_seq: rows.length === limit ? rows[rows.length - 1].seq : null,
  }
}
