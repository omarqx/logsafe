import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'
import { normalizeEvent } from '../src/normalize.js'
import { insertBatch } from '../src/ingest.js'
import { pruneSessions } from '../src/retention.js'

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0)
const DAY = 86_400_000

describe('pruneSessions', () => {
  it('deletes whole sessions older than the cutoff, keeps the rest', () => {
    const db = openDb(':memory:')
    insertBatch(db, [
      normalizeEvent({ msg: 'old', session_id: 'old', ts: NOW - 8 * DAY }, NOW)!,
      normalizeEvent({ msg: 'fresh', session_id: 'fresh', ts: NOW - 6 * DAY }, NOW)!,
    ])
    expect(pruneSessions(db, 7, NOW)).toBe(1)
    const ids = (db.prepare('SELECT id FROM sessions').all() as { id: string }[]).map((r) => r.id)
    expect(ids).toEqual(['fresh'])
    const orphans = db.prepare(`SELECT count(*) AS c FROM events WHERE session_id = 'old'`).get() as { c: number }
    expect(orphans.c).toBe(0)
  })

  it('retentionDays <= 0 disables pruning', () => {
    const db = openDb(':memory:')
    insertBatch(db, [normalizeEvent({ msg: 'ancient', session_id: 's', ts: 0 }, NOW)!])
    expect(pruneSessions(db, 0, NOW)).toBe(0)
    expect(db.prepare('SELECT count(*) AS c FROM sessions').get()).toEqual({ c: 1 })
  })
})
