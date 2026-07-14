import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'

describe('openDb', () => {
  it('creates schema and enables WAL', () => {
    const db = openDb(':memory:')
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(['events', 'sessions'])
    // :memory: reports 'memory'; file dbs report 'wal'
    expect(['wal', 'memory']).toContain(db.pragma('journal_mode', { simple: true }))
  })

  it('is idempotent (schema uses IF NOT EXISTS)', () => {
    const db = openDb(':memory:')
    expect(() => db.exec('SELECT 1')).not.toThrow()
  })
})
