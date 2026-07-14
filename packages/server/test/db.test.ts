import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

describe('openDb', () => {
  it('creates schema and enables WAL', () => {
    const db = openDb(':memory:')
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    // sqlite_sequence is an internal bookkeeping table SQLite creates
    // automatically for AUTOINCREMENT columns (see events.seq in db.ts).
    expect(tables.map((t) => t.name)).toEqual(['events', 'sessions', 'sqlite_sequence'])
    // :memory: reports 'memory'; file dbs report 'wal'
    expect(['wal', 'memory']).toContain(db.pragma('journal_mode', { simple: true }))
  })

  it('is idempotent: reopening the same file re-applies schema safely', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deblog-test-')), 'test.db')
    const first = openDb(file)
    first.prepare(`INSERT INTO sessions (id, first_ts, last_ts) VALUES ('s', 1, 1)`).run()
    first.close()
    const again = openDb(file) // second run must not throw or clobber data
    expect(again.pragma('journal_mode', { simple: true })).toBe('wal')
    const row = again.prepare('SELECT id FROM sessions').get() as { id: string }
    expect(row.id).toBe('s')
    again.close()
  })
})
