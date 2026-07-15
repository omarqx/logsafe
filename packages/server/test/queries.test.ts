import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { normalizeEvent } from '../src/normalize.js'
import { insertBatch } from '../src/ingest.js'
import { nsToGlob, queryEvents, listSessions, getSession, deleteSession, ACTIVE_WINDOW_MS } from '../src/queries.js'

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0)

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  const raw = [
    { msg: 'token ok', ns: 'auth:token', source: 'api', level: 'debug', ts: 1000 },
    { msg: 'login failed', ns: 'auth:login', source: 'api', level: 'error', ts: 2000, trace: 't-1' },
    { msg: 'buffer low', ns: 'player.buffer', source: 'webapp', level: 'warn', ts: 3000 },
    { msg: 'render done', ns: 'player.render', source: 'webapp', level: 'info', ts: 4000, ctx: { frames: 60 } },
    { msg: 'retry login', ns: 'auth:login', source: 'webapp', level: 'info', ts: 5000, trace: 't-1' },
  ]
  insertBatch(db, raw.map((r) => normalizeEvent({ session_id: 's1', ...r }, NOW)!))
})

describe('nsToGlob', () => {
  it('keeps * and escapes GLOB metacharacters', () => {
    expect(nsToGlob('auth:*')).toBe('auth:*')
    expect(nsToGlob('a[b]?c')).toBe('a[[]b][?]c')
  })
})

describe('queryEvents', () => {
  it('no filters: all events, seq ASC, null cursor when page not full', () => {
    const { events, next_after_seq } = queryEvents(db, 's1', {})
    expect(events).toHaveLength(5)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(next_after_seq).toBeNull()
  })

  it('ns wildcard, comma = OR', () => {
    expect(queryEvents(db, 's1', { ns: 'auth:*' }).events).toHaveLength(3)
    expect(queryEvents(db, 's1', { ns: 'auth:*,player.*' }).events).toHaveLength(5)
    expect(queryEvents(db, 's1', { ns: 'auth:login' }).events).toHaveLength(2)
  })

  it('level and source lists, AND across params', () => {
    expect(queryEvents(db, 's1', { level: 'warn,error' }).events).toHaveLength(2)
    expect(queryEvents(db, 's1', { level: 'info', source: 'webapp' }).events).toHaveLength(2)
    expect(queryEvents(db, 's1', { ns: 'auth:*', level: 'error' }).events).toHaveLength(1)
  })

  it('filters events by type', () => {
    const db = openDb(':memory:')
    insertBatch(db, [normalizeEvent({ msg: 'a', session_id: 's', type: 'psdk' }, 1)!, normalizeEvent({ msg: 'b', session_id: 's' }, 1)!])
    expect(queryEvents(db, 's', { type: 'generic' }).events.map((e) => e.msg)).toEqual(['b'])
  })

  it('trace exact match', () => {
    const { events } = queryEvents(db, 's1', { trace: 't-1' })
    expect(events.map((e) => e.msg)).toEqual(['login failed', 'retry login'])
  })

  it('q searches msg and ctx, case-insensitive, LIKE-escaped', () => {
    expect(queryEvents(db, 's1', { q: 'LOGIN' }).events).toHaveLength(2)
    expect(queryEvents(db, 's1', { q: 'frames' }).events).toHaveLength(1) // matches ctx
    expect(queryEvents(db, 's1', { q: '100%' }).events).toHaveLength(0)  // % is literal
  })

  it('ts range and seq cursors', () => {
    expect(queryEvents(db, 's1', { from_ts: 2000, to_ts: 4000 }).events).toHaveLength(3)
    expect(queryEvents(db, 's1', { after_seq: 3 }).events.map((e) => e.seq)).toEqual([4, 5])
    expect(queryEvents(db, 's1', { before_seq: 3 }).events).toHaveLength(2)
  })

  it('pagination: full page yields next_after_seq', () => {
    const page1 = queryEvents(db, 's1', { limit: 2 })
    expect(page1.events.map((e) => e.seq)).toEqual([1, 2])
    expect(page1.next_after_seq).toBe(2)
    const page2 = queryEvents(db, 's1', { limit: 2, after_seq: page1.next_after_seq! })
    expect(page2.events.map((e) => e.seq)).toEqual([3, 4])
  })

  it('unknown session returns empty', () => {
    expect(queryEvents(db, 'nope', {}).events).toEqual([])
  })

  it('fractional limit is truncated, not a datatype error', () => {
    expect(() => queryEvents(db, 's1', { limit: 2.5 })).not.toThrow()
    expect(queryEvents(db, 's1', { limit: 2.5 }).events).toHaveLength(2)
  })
})

describe('sessions', () => {
  it('listSessions: newest first, computed status and duration', () => {
    // s1 fixture: first_ts=1000, last_ts=5000
    insertBatch(db, [normalizeEvent({ msg: 'x', session_id: 's2', ts: NOW }, NOW)!])
    const sessions = listSessions(db, 50, 0, NOW)
    expect(sessions.map((s) => s.id)).toEqual(['s2', 's1'])
    expect(sessions[0].status).toBe('active') // last_ts === now
    expect(sessions[1].status).toBe('idle')   // last_ts = 5000, ancient
    expect(sessions[1].duration_ms).toBe(4000)
    expect(sessions[1].sources).toEqual(['api', 'webapp'])
    expect(sessions[1].event_count).toBe(5)
    expect(sessions[1].error_count).toBe(1)
  })

  it('status boundary: active within ACTIVE_WINDOW_MS', () => {
    insertBatch(db, [normalizeEvent({ msg: 'x', session_id: 's3', ts: NOW - ACTIVE_WINDOW_MS }, NOW)!])
    expect(getSession(db, 's3', NOW)!.status).toBe('active')
    expect(getSession(db, 's3', NOW + 1)!.status).toBe('idle')
  })

  it('getSession returns null for unknown id', () => {
    expect(getSession(db, 'nope', NOW)).toBeNull()
  })

  it('deleteSession removes session and its events', () => {
    expect(deleteSession(db, 's1')).toBe(true)
    expect(getSession(db, 's1', NOW)).toBeNull()
    const c = db.prepare(`SELECT count(*) AS c FROM events WHERE session_id = 's1'`).get() as { c: number }
    expect(c.c).toBe(0)
    expect(deleteSession(db, 's1')).toBe(false)
  })

  it('listSessions clamps hostile limit/offset (negative limit is not unlimited)', () => {
    insertBatch(db, [normalizeEvent({ msg: 'x', session_id: 's2', ts: NOW }, NOW)!])
    // fixture has s1 + s2; a negative limit must not return everything
    expect(listSessions(db, -1, 0, NOW)).toHaveLength(1)
    expect(listSessions(db, 50, -5, NOW)).toHaveLength(2)
    expect(listSessions(db, 2.5, 0, NOW)).toHaveLength(2)   // fractional must not throw
    expect(listSessions(db, 50, 0.5, NOW)).toHaveLength(2)
  })
})

describe('queries: type surfaced', () => {
  it('returns type on events and types[] on the session', () => {
    const db = openDb(':memory:')
    const ev = normalizeEvent({ msg: 'a', session_id: 's1', type: 'psdk' }, 5)!
    insertBatch(db, [ev])
    expect(queryEvents(db, 's1', {}).events[0].type).toBe('psdk')
    expect(getSession(db, 's1', 10)!.types).toEqual(['psdk'])
  })
})
