import { describe, it, expect } from 'vitest'
import { openDb, migrateSchema } from '../src/db.js'
import Database from 'better-sqlite3'
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
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'logsafe-test-')), 'test.db')
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

describe('schema: plugin type columns', () => {
  it('adds type to events and types to sessions with defaults', () => {
    const db = openDb(':memory:')
    const eventCols = (db.prepare(`PRAGMA table_info(events)`).all() as { name: string; dflt_value: string }[])
    const typeCol = eventCols.find((c) => c.name === 'type')
    expect(typeCol).toBeTruthy()
    expect(typeCol?.dflt_value).toBe("'generic'")
    const sessionCols = (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string; dflt_value: string }[])
    const typesCol = sessionCols.find((c) => c.name === 'types')
    expect(typesCol).toBeTruthy()
    expect(typesCol?.dflt_value).toBe("'[]'")
  })

  it('upgrades a pre-existing db that lacks the columns', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts INTEGER NOT NULL, received_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'default', ns TEXT NOT NULL DEFAULT '', level TEXT NOT NULL, msg TEXT NOT NULL, ctx TEXT, trace TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT, first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL, event_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, warn_count INTEGER NOT NULL DEFAULT 0, sources TEXT NOT NULL DEFAULT '[]');
      INSERT INTO sessions (id, first_ts, last_ts) VALUES ('old', 1, 1);`)
    // Upgrade a legacy db that predates the type/types columns by calling migrateSchema directly.
    migrateSchema(db)
    const row = db.prepare(`SELECT types FROM sessions WHERE id = 'old'`).get() as { types: string }
    expect(row.types).toBe('[]')
  })
})
