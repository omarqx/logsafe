import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export type Db = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  label       TEXT,
  first_ts    INTEGER NOT NULL,
  last_ts     INTEGER NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warn_count  INTEGER NOT NULL DEFAULT 0,
  sources     TEXT NOT NULL DEFAULT '[]',
  types       TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'default',
  ns          TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL,
  msg         TEXT NOT NULL,
  ctx         TEXT,
  trace       TEXT,
  type        TEXT NOT NULL DEFAULT 'generic'
);
CREATE INDEX IF NOT EXISTS idx_events_session_ns    ON events(session_id, ns);
CREATE INDEX IF NOT EXISTS idx_events_session_level ON events(session_id, level);
CREATE INDEX IF NOT EXISTS idx_events_session_ts    ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_session_type  ON events(session_id, type);
`

function hasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some((c) => c.name === column)
}

/** Additive, idempotent upgrades for databases created before a column existed.
    `CREATE TABLE IF NOT EXISTS` won't alter an existing table, so ALTER here. */
export function migrateSchema(db: Db): void {
  if (!hasColumn(db, 'events', 'type')) {
    db.exec(`ALTER TABLE events ADD COLUMN type TEXT NOT NULL DEFAULT 'generic'`)
  }
  if (!hasColumn(db, 'sessions', 'types')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN types TEXT NOT NULL DEFAULT '[]'`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, type)`)
}

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  migrateSchema(db)
  return db
}
