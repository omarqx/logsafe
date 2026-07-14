import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'
import { normalizeEvent, type NormalizedEvent } from '../src/normalize.js'
import { insertBatch } from '../src/ingest.js'

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0)

function ev(over: Record<string, unknown>): NormalizedEvent {
  return normalizeEvent({ msg: 'm', session_id: 's1', ...over }, NOW)!
}

describe('insertBatch', () => {
  it('assigns monotonically increasing seq and returns parsed ctx', () => {
    const db = openDb(':memory:')
    const stored = insertBatch(db, [ev({ ctx: { a: 1 } }), ev({}), ev({})])
    expect(stored.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(stored[0].ctx).toEqual({ a: 1 })
    expect(stored[1].ctx).toBeNull()
  })

  it('upserts session with counters, sources union, min/max ts, label', () => {
    const db = openDb(':memory:')
    insertBatch(db, [
      ev({ source: 'webapp', level: 'error', ts: 1000, session_label: 'run A' }),
      ev({ source: 'api', level: 'warn', ts: 500 }),
    ])
    insertBatch(db, [ev({ source: 'api', level: 'error', ts: 2000 })])

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1') as Record<string, unknown>
    expect(row.event_count).toBe(3)
    expect(row.error_count).toBe(2)
    expect(row.warn_count).toBe(1)
    expect(row.first_ts).toBe(500)
    expect(row.last_ts).toBe(2000)
    expect(row.label).toBe('run A')
    expect(JSON.parse(row.sources as string)).toEqual(['api', 'webapp'])
  })

  it('handles multiple sessions in one batch', () => {
    const db = openDb(':memory:')
    insertBatch(db, [ev({}), ev({ session_id: 's2' })])
    const count = db.prepare('SELECT count(*) AS c FROM sessions').get() as { c: number }
    expect(count.c).toBe(2)
  })

  it('a later batch without a label keeps the existing label', () => {
    const db = openDb(':memory:')
    insertBatch(db, [ev({ session_label: 'keep me' })])
    insertBatch(db, [ev({})])
    const row = db.prepare('SELECT label FROM sessions WHERE id = ?').get('s1') as { label: string }
    expect(row.label).toBe('keep me')
  })
})
