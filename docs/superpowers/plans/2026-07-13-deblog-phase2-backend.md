# deblog Phase 2 (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deblog log server (Fastify + better-sqlite3), the `@deblog/client` helper, a two-source demo script, and freeze the HTTP contract into API.md.

**Architecture:** npm-workspaces monorepo. `packages/server` is a Fastify app over a synchronous better-sqlite3 WAL database — one ingest batch = one transaction, sessions upserted with denormalized counters in the same transaction. `packages/client` is a zero-dependency batching logger. SSE fan-out is an in-process pub/sub keyed by session id.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Fastify 5, @fastify/cors, @fastify/static, better-sqlite3, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-07-13-deblog-design.md` — the authority on every behavior below.

## Global Constraints

- Node >= 20, ESM everywhere (`"type": "module"`), TypeScript strict mode.
- Server binds `127.0.0.1` only. Default port `4600`. Env: `PORT`, `DEBLOG_DB` (default `~/.deblog/deblog.db`), `RETENTION_DAYS` (default `7`, `0` disables).
- Coercion over rejection: only malformed JSON or missing/empty `msg` rejects an event; in array batches bad events are skipped and counted, never failing the batch.
- Canonical API ordering and pagination cursor: `seq ASC` (server arrival order).
- Ingest limits: 5 MB body, 1000 events/batch → `413`.
- Permissive CORS on all routes; `text/plain` bodies parsed as JSON (sendBeacon can't preflight).
- `@deblog/client` has zero runtime dependencies and must never throw into the host app.
- Levels: exactly `debug | info | warn | error`.
- Commit after every task. Run commands from repo root `~/sandbox/deblog`.

## File Structure

```
deblog/
  package.json                     # workspaces root, scripts: start/demo/test/typecheck
  tsconfig.base.json
  vitest.config.ts
  .gitignore
  API.md                           # Task 11 — frozen contract
  README.md                        # Task 11 — incl. "For AI coding agents"
  packages/server/
    package.json
    tsconfig.json
    src/db.ts                      # openDb(): schema, WAL
    src/normalize.ts               # normalizeEvent(): coercion matrix
    src/ingest.ts                  # insertBatch(): txn, session upsert, counters
    src/queries.ts                 # nsToGlob, queryEvents, list/get/deleteSession
    src/sse.ts                     # SseHub pub/sub
    src/app.ts                     # buildApp(): all routes
    src/retention.ts               # pruneSessions()
    src/index.ts                   # entrypoint: env, listen, retention schedule
    test/normalize.test.ts
    test/ingest.test.ts
    test/queries.test.ts
    test/api.test.ts               # route integration via app.inject
    test/sse.test.ts               # real listen + streaming fetch
    test/retention.test.ts
  packages/client/
    package.json                   # @deblog/client, zero deps, tsc build → dist/
    tsconfig.json
    src/index.ts                   # initDeblog, createLog, flush, batching
    test/client.test.ts
  examples/demo.ts                 # Task 10 — two-source demo, doubles as e2e
```

---

### Task 1: Monorepo scaffold + DB module

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `packages/server/src/db.ts`
- Test: `packages/server/test/db.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `openDb(file: string): Db` — opens/creates the SQLite db, WAL mode, idempotent schema. `type Db = Database.Database` (better-sqlite3). `':memory:'` accepted for tests.

- [ ] **Step 1: Write scaffold files**

`package.json` (root):

```json
{
  "name": "deblog",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "start": "tsx packages/server/src/index.ts",
    "demo": "tsx examples/demo.ts",
    "test": "vitest run",
    "typecheck": "tsc -p packages/server && tsc -p packages/client --noEmit"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
```

`.gitignore`:

```
node_modules/
dist/
*.db
*.db-shm
*.db-wal
```

`packages/server/package.json`:

```json
{
  "name": "@deblog/server",
  "private": true,
  "type": "module",
  "version": "0.1.0"
}
```

`packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
npm install -w packages/server fastify @fastify/cors @fastify/static better-sqlite3
npm install -D typescript tsx vitest @types/node @types/better-sqlite3
```

- [ ] **Step 3: Write the failing test**

`packages/server/test/db.test.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run packages/server/test/db.test.ts`
Expected: FAIL — cannot resolve `../src/db.js`

- [ ] **Step 5: Write the implementation**

`packages/server/src/db.ts`:

```ts
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
  sources     TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY,
  session_id  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'default',
  ns          TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL,
  msg         TEXT NOT NULL,
  ctx         TEXT,
  trace       TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_session_ns    ON events(session_id, ns);
CREATE INDEX IF NOT EXISTS idx_events_session_level ON events(session_id, level);
CREATE INDEX IF NOT EXISTS idx_events_session_ts    ON events(session_id, ts);
`

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  return db
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/server/test/db.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: monorepo scaffold + SQLite schema (WAL)"
```

---

### Task 2: Event normalization

**Files:**
- Create: `packages/server/src/normalize.ts`
- Test: `packages/server/test/normalize.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Level = 'debug' | 'info' | 'warn' | 'error'`; `const LEVELS: readonly Level[]`
  - `interface NormalizedEvent { session_id: string; ts: number; received_at: number; source: string; ns: string; level: Level; msg: string; ctx: string | null; trace: string | null; session_label: string | null }` (`ctx` is a JSON *string* here; parsed only on the way out of the API)
  - `normalizeEvent(raw: unknown, now: number): NormalizedEvent | null` — null only for unsalvageable events (not an object / missing or empty `msg`)
  - `scratchSessionId(now: number): string` — `scratch-YYYY-MM-DD`

- [ ] **Step 1: Write the failing test**

`packages/server/test/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeEvent, scratchSessionId } from '../src/normalize.js'

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0) // 2026-07-13T12:00:00Z

describe('normalizeEvent', () => {
  it('rejects only non-objects and missing/empty msg', () => {
    expect(normalizeEvent(null, NOW)).toBeNull()
    expect(normalizeEvent('hi', NOW)).toBeNull()
    expect(normalizeEvent([{ msg: 'x' }], NOW)).toBeNull()
    expect(normalizeEvent({}, NOW)).toBeNull()
    expect(normalizeEvent({ msg: '' }, NOW)).toBeNull()
    expect(normalizeEvent({ msg: 'x' }, NOW)).not.toBeNull()
  })

  it('applies defaults: source, ns, level, ts, scratch session', () => {
    const ev = normalizeEvent({ msg: 'hello' }, NOW)!
    expect(ev).toMatchObject({
      session_id: 'scratch-2026-07-13',
      source: 'default',
      ns: '',
      level: 'info',
      msg: 'hello',
      ts: NOW,
      received_at: NOW,
      ctx: null,
      trace: null,
      session_label: null,
    })
  })

  it('accepts epoch-ms and ISO ts; bad ts falls back to now', () => {
    expect(normalizeEvent({ msg: 'x', ts: 1234 }, NOW)!.ts).toBe(1234)
    expect(normalizeEvent({ msg: 'x', ts: '2026-07-13T11:59:00Z' }, NOW)!.ts).toBe(NOW - 60_000)
    expect(normalizeEvent({ msg: 'x', ts: 'garbage' }, NOW)!.ts).toBe(NOW)
    expect(normalizeEvent({ msg: 'x', ts: NaN }, NOW)!.ts).toBe(NOW)
  })

  it('coerces unknown level to info, preserving original at ctx._level', () => {
    const noCtx = normalizeEvent({ msg: 'x', level: 'FATAL' }, NOW)!
    expect(noCtx.level).toBe('info')
    expect(JSON.parse(noCtx.ctx!)).toEqual({ _level: 'FATAL' })

    const objCtx = normalizeEvent({ msg: 'x', level: 'trace', ctx: { a: 1 } }, NOW)!
    expect(JSON.parse(objCtx.ctx!)).toEqual({ a: 1, _level: 'trace' })

    const scalarCtx = normalizeEvent({ msg: 'x', level: 5, ctx: 'raw' }, NOW)!
    expect(JSON.parse(scalarCtx.ctx!)).toEqual({ _level: 5, value: 'raw' })
  })

  it('passes through valid fields, serializes ctx', () => {
    const ev = normalizeEvent(
      { msg: 'm', session_id: 's1', source: 'api', ns: 'auth:token', level: 'error', ctx: { u: 7 }, trace: 't-1', session_label: 'run A' },
      NOW,
    )!
    expect(ev).toMatchObject({ session_id: 's1', source: 'api', ns: 'auth:token', level: 'error', trace: 't-1', session_label: 'run A' })
    expect(ev.ctx).toBe(JSON.stringify({ u: 7 }))
  })
})

describe('scratchSessionId', () => {
  it('buckets by UTC day', () => {
    expect(scratchSessionId(NOW)).toBe('scratch-2026-07-13')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/normalize.test.ts`
Expected: FAIL — cannot resolve `../src/normalize.js`

- [ ] **Step 3: Write the implementation**

`packages/server/src/normalize.ts`:

```ts
export const LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type Level = (typeof LEVELS)[number]

export interface NormalizedEvent {
  session_id: string
  ts: number
  received_at: number
  source: string
  ns: string
  level: Level
  msg: string
  ctx: string | null
  trace: string | null
  session_label: string | null
}

const LEVEL_SET = new Set<string>(LEVELS)

export function scratchSessionId(now: number): string {
  return `scratch-${new Date(now).toISOString().slice(0, 10)}`
}

/** Returns null only for unsalvageable events: not a plain object, or no msg.
    Everything else is coerced — a log tool must not reject logs it can salvage. */
export function normalizeEvent(raw: unknown, now: number): NormalizedEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.msg !== 'string' || r.msg === '') return null

  let ts = now
  if (typeof r.ts === 'number' && Number.isFinite(r.ts)) ts = Math.trunc(r.ts)
  else if (typeof r.ts === 'string') {
    const parsed = Date.parse(r.ts)
    if (!Number.isNaN(parsed)) ts = parsed
  }

  let level: Level = 'info'
  let coercedLevel: unknown
  if (typeof r.level === 'string' && LEVEL_SET.has(r.level)) level = r.level as Level
  else if (r.level !== undefined) coercedLevel = r.level

  let ctxValue = r.ctx
  if (coercedLevel !== undefined) {
    if (ctxValue !== null && typeof ctxValue === 'object' && !Array.isArray(ctxValue)) {
      ctxValue = { ...(ctxValue as Record<string, unknown>), _level: coercedLevel }
    } else if (ctxValue === undefined) {
      ctxValue = { _level: coercedLevel }
    } else {
      ctxValue = { _level: coercedLevel, value: ctxValue }
    }
  }

  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

  return {
    session_id: str(r.session_id) ?? scratchSessionId(now),
    ts,
    received_at: now,
    source: str(r.source) ?? 'default',
    ns: typeof r.ns === 'string' ? r.ns : '',
    level,
    msg: r.msg,
    ctx: ctxValue === undefined ? null : JSON.stringify(ctxValue),
    trace: str(r.trace),
    session_label: str(r.session_label),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/test/normalize.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: event normalization with coercion-over-rejection"
```

---

### Task 3: Batch insert + session upsert

**Files:**
- Create: `packages/server/src/ingest.ts`
- Test: `packages/server/test/ingest.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 1); `NormalizedEvent`, `Level` (Task 2)
- Produces:
  - `interface StoredEvent { seq: number; session_id: string; ts: number; received_at: number; source: string; ns: string; level: Level; msg: string; ctx: unknown; trace: string | null }` — `ctx` is *parsed* JSON here; this is the exact event shape the API returns everywhere (events list, NDJSON lines, SSE `data`)
  - `insertBatch(db: Db, events: NormalizedEvent[]): StoredEvent[]` — one transaction; upserts session rows (counters, sources union, min/max ts, last non-empty label wins); returns stored events with assigned `seq`

- [ ] **Step 1: Write the failing test**

`packages/server/test/ingest.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/ingest.test.ts`
Expected: FAIL — cannot resolve `../src/ingest.js`

- [ ] **Step 3: Write the implementation**

`packages/server/src/ingest.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/test/ingest.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: transactional batch insert with denormalized session counters"
```

---

### Task 4: Events query builder (ns GLOB + filters)

**Files:**
- Create: `packages/server/src/queries.ts`
- Test: `packages/server/test/queries.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), `StoredEvent` (Task 3)
- Produces:
  - `interface EventFilters { ns?: string; level?: string; source?: string; trace?: string; q?: string; from_ts?: number; to_ts?: number; after_seq?: number; before_seq?: number; limit?: number }` (comma-separated lists inside `ns`/`level`/`source`; OR within a param, AND across params)
  - `nsToGlob(pattern: string): string` — escapes `[` and `?` GLOB metacharacters, keeps `*`
  - `queryEvents(db: Db, sessionId: string, f: EventFilters): { events: StoredEvent[]; next_after_seq: number | null }` — ordered `seq ASC`; limit default 500, max 10000; `next_after_seq` = last row's seq when the page is full, else null
  - `DEFAULT_LIMIT = 500`, `MAX_LIMIT = 10000` (exported constants)
  - (Session list/get/delete are Task 5, same file)

- [ ] **Step 1: Write the failing test**

`packages/server/test/queries.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { normalizeEvent } from '../src/normalize.js'
import { insertBatch } from '../src/ingest.js'
import { nsToGlob, queryEvents } from '../src/queries.js'

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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/queries.test.ts`
Expected: FAIL — cannot resolve `../src/queries.js`

- [ ] **Step 3: Write the implementation**

`packages/server/src/queries.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/test/queries.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: events query builder with ns GLOB, filters, seq pagination"
```

---

### Task 5: Session queries (list / get / delete)

**Files:**
- Modify: `packages/server/src/queries.ts` (append)
- Test: `packages/server/test/queries.test.ts` (append)

**Interfaces:**
- Consumes: sessions table (Task 1), counters maintained by Task 3
- Produces:
  - `interface SessionSummary { id: string; label: string | null; first_ts: number; last_ts: number; duration_ms: number; status: 'active' | 'idle'; event_count: number; error_count: number; warn_count: number; sources: string[] }`
  - `listSessions(db: Db, limit: number, offset: number, now: number): SessionSummary[]` — ordered `last_ts DESC`
  - `getSession(db: Db, id: string, now: number): SessionSummary | null`
  - `deleteSession(db: Db, id: string): boolean` — deletes events + session row in one transaction; false if unknown id
  - `ACTIVE_WINDOW_MS = 60_000` (exported)

- [ ] **Step 1: Write the failing test**

Append to `packages/server/test/queries.test.ts`:

```ts
import { listSessions, getSession, deleteSession, ACTIVE_WINDOW_MS } from '../src/queries.js'

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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/queries.test.ts`
Expected: FAIL — `listSessions` is not exported

- [ ] **Step 3: Write the implementation**

Append to `packages/server/src/queries.ts`:

```ts
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
  }
}

export function listSessions(db: Db, limit: number, offset: number, now: number): SessionSummary[] {
  const rows = db
    .prepare('SELECT * FROM sessions ORDER BY last_ts DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as SessionRow[]
  return rows.map((r) => rowToSession(r, now))
}

export function getSession(db: Db, id: string, now: number): SessionSummary | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  return row ? rowToSession(row, now) : null
}

export function deleteSession(db: Db, id: string): boolean {
  const run = db.transaction((sid: string): boolean => {
    db.prepare('DELETE FROM events WHERE session_id = ?').run(sid)
    const res = db.prepare('DELETE FROM sessions WHERE id = ?').run(sid)
    return res.changes > 0
  })
  return run(id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/test/queries.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: session list/get/delete with computed status"
```

---

### Task 6: HTTP API (Fastify app + routes)

**Files:**
- Create: `packages/server/src/app.ts`
- Test: `packages/server/test/api.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces:
  - `interface AppOptions { db: Db; now?: () => number }`
  - `buildApp(opts: AppOptions): FastifyInstance` — registers all routes below plus CORS and the text/plain parser. Does NOT listen (caller does), does NOT register the SSE route yet (Task 7 adds it inside buildApp).
  - `MAX_BATCH = 1000`, `BODY_LIMIT = 5 * 1024 * 1024` (exported)
  - Routes: `POST /v1/log`, `GET /api/health`, `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/sessions/:id/events`, `GET /api/sessions/:id/export.ndjson`, `DELETE /api/sessions/:id`

- [ ] **Step 1: Write the failing test**

`packages/server/test/api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0)

let app: FastifyInstance
beforeEach(async () => {
  app = buildApp({ db: openDb(':memory:'), now: () => NOW })
  await app.ready()
})

const post = (payload: unknown, contentType = 'application/json') =>
  app.inject({
    method: 'POST',
    url: '/v1/log',
    headers: { 'content-type': contentType },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })

describe('POST /v1/log', () => {
  it('accepts a single event with only msg', async () => {
    const res = await post({ msg: 'hello' })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
  })

  it('accepts a batch, skips bad events without failing the batch', async () => {
    const res = await post([{ msg: 'a', session_id: 's1' }, { nope: true }, { msg: 'b', session_id: 's1' }])
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 2, rejected: 1 })
  })

  it('rejects a single invalid event with 400', async () => {
    expect((await post({ nope: true })).statusCode).toBe(400)
    expect((await post('not json at all')).statusCode).toBe(400)
  })

  it('rejects oversize batches with 413', async () => {
    const batch = Array.from({ length: 1001 }, () => ({ msg: 'x' }))
    expect((await post(batch)).statusCode).toBe(413)
  })

  it('parses text/plain bodies as JSON (sendBeacon path)', async () => {
    const res = await post(JSON.stringify([{ msg: 'beacon', session_id: 's1' }]), 'text/plain')
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
  })

  it('sends permissive CORS headers', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/log',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    })
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})

describe('query routes', () => {
  beforeEach(async () => {
    await post([
      { msg: 'token ok', session_id: 's1', source: 'api', ns: 'auth:token', level: 'debug', ts: NOW - 5000 },
      { msg: 'login failed', session_id: 's1', source: 'api', ns: 'auth:login', level: 'error', ts: NOW - 4000 },
      { msg: 'render', session_id: 's1', source: 'webapp', ns: 'player.render', level: 'info', ts: NOW - 3000, session_label: 'demo run' },
    ])
  })

  it('GET /api/health', async () => {
    const res = await app.inject('/api/health')
    expect(res.json()).toEqual({ ok: true })
  })

  it('GET /api/sessions returns summaries', async () => {
    const res = await app.inject('/api/sessions')
    const sessions = res.json()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: 's1',
      label: 'demo run',
      event_count: 3,
      error_count: 1,
      status: 'active',
      sources: ['api', 'webapp'],
    })
  })

  it('GET /api/sessions/:id and 404', async () => {
    expect((await app.inject('/api/sessions/s1')).json().id).toBe('s1')
    expect((await app.inject('/api/sessions/nope')).statusCode).toBe(404)
  })

  it('GET /api/sessions/:id/events applies filters from query string', async () => {
    const res = await app.inject('/api/sessions/s1/events?ns=auth:*&level=error')
    const body = res.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0].msg).toBe('login failed')
    expect(body.next_after_seq).toBeNull()
  })

  it('GET export.ndjson streams one JSON object per line', async () => {
    const res = await app.inject('/api/sessions/s1/export.ndjson')
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    const lines = res.body.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(3)
    expect(lines[0].seq).toBe(1)
  })

  it('DELETE /api/sessions/:id', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })).statusCode).toBe(204)
    expect((await app.inject('/api/sessions/s1')).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })).statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/api.test.ts`
Expected: FAIL — cannot resolve `../src/app.js`

- [ ] **Step 3: Write the implementation**

`packages/server/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { Db } from './db.js'
import { normalizeEvent, type NormalizedEvent } from './normalize.js'
import { insertBatch, type StoredEvent } from './ingest.js'
import { queryEvents, listSessions, getSession, deleteSession, type EventFilters } from './queries.js'

export const MAX_BATCH = 1000
export const BODY_LIMIT = 5 * 1024 * 1024

export interface AppOptions {
  db: Db
  now?: () => number
}

function num(v: unknown): number | undefined {
  if (typeof v !== 'string' || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function parseFilters(q: Record<string, unknown>): EventFilters {
  return {
    ns: str(q.ns),
    level: str(q.level),
    source: str(q.source),
    trace: str(q.trace),
    q: str(q.q),
    from_ts: num(q.from_ts),
    to_ts: num(q.to_ts),
    after_seq: num(q.after_seq),
    before_seq: num(q.before_seq),
    limit: num(q.limit),
  }
}

export function buildApp({ db, now = Date.now }: AppOptions): FastifyInstance {
  const app = Fastify({ bodyLimit: BODY_LIMIT })

  app.register(cors, { origin: true })

  // navigator.sendBeacon can only send "simple" content types without a CORS
  // preflight it cannot perform, so the browser helper beacons text/plain.
  app.addContentTypeParser(['text/plain'], { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string))
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  app.post('/v1/log', (req, reply) => {
    const body = req.body
    const t = now()
    if (Array.isArray(body)) {
      if (body.length > MAX_BATCH) {
        return reply.code(413).send({ error: `batch exceeds ${MAX_BATCH} events` })
      }
      const good: NormalizedEvent[] = []
      for (const raw of body) {
        const ev = normalizeEvent(raw, t)
        if (ev) good.push(ev)
      }
      const stored = insertBatch(db, good)
      afterInsert(stored)
      return reply.code(202).send({ accepted: good.length, rejected: body.length - good.length })
    }
    const ev = normalizeEvent(body, t)
    if (!ev) {
      return reply.code(400).send({ error: 'event must be an object with a non-empty string msg' })
    }
    const stored = insertBatch(db, [ev])
    afterInsert(stored)
    return reply.code(202).send({ accepted: 1, rejected: 0 })
  })

  // Task 7 (SSE) replaces this no-op with hub.publish.
  let afterInsert: (events: StoredEvent[]) => void = () => {}
  const setAfterInsert = (fn: (events: StoredEvent[]) => void): void => {
    afterInsert = fn
  }
  void setAfterInsert // referenced by Task 7

  app.get('/api/health', () => ({ ok: true }))

  app.get('/api/sessions', (req) => {
    const q = req.query as Record<string, unknown>
    return listSessions(db, num(q.limit) ?? 50, num(q.offset) ?? 0, now())
  })

  app.get('/api/sessions/:id', (req, reply) => {
    const { id } = req.params as { id: string }
    const session = getSession(db, id, now())
    if (!session) return reply.code(404).send({ error: 'session not found' })
    return session
  })

  app.get('/api/sessions/:id/events', (req) => {
    const { id } = req.params as { id: string }
    return queryEvents(db, id, parseFilters(req.query as Record<string, unknown>))
  })

  app.get('/api/sessions/:id/export.ndjson', (req, reply) => {
    const { id } = req.params as { id: string }
    const filters = parseFilters(req.query as Record<string, unknown>)
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'access-control-allow-origin': '*',
    })
    let after = filters.after_seq
    for (;;) {
      const { events, next_after_seq } = queryEvents(db, id, { ...filters, after_seq: after, limit: 5000 })
      for (const ev of events) reply.raw.write(JSON.stringify(ev) + '\n')
      if (next_after_seq === null) break
      after = next_after_seq
    }
    reply.raw.end()
  })

  app.delete('/api/sessions/:id', (req, reply) => {
    const { id } = req.params as { id: string }
    if (!deleteSession(db, id)) return reply.code(404).send({ error: 'session not found' })
    return reply.code(204).send()
  })

  return app
}
```

Note: `afterInsert`/`setAfterInsert` is scaffolding Task 7 converts into the SSE hub publish — Task 7 rewrites those lines; don't polish them here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/test/api.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: HTTP API — ingest, sessions, events, ndjson export, CORS"
```

---

### Task 7: SSE live tail

**Files:**
- Create: `packages/server/src/sse.ts`
- Modify: `packages/server/src/app.ts` (wire hub + add stream route)
- Test: `packages/server/test/sse.test.ts`

**Interfaces:**
- Consumes: `buildApp` internals (Task 6), `queryEvents` (Task 4), `StoredEvent` (Task 3)
- Produces:
  - `class SseHub { subscribe(sessionId: string, fn: (events: StoredEvent[]) => void): () => void; publish(sessionId: string, events: StoredEvent[]): void }`
  - Route `GET /api/sessions/:id/stream?after_seq=N` — SSE: replays events with `seq > after_seq` (default 0), then live. Frames: `event: log\ndata: <StoredEvent JSON>\n\n`; heartbeat comment `: hb\n\n` every 15s. Works for sessions that don't exist yet (subscribes anyway — logs may arrive later).

- [ ] **Step 1: Write the failing test**

`packages/server/test/sse.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'

let app: FastifyInstance
afterEach(async () => {
  await app.close()
})

/** Read SSE 'log' frames from a streaming response until `count` events arrive. */
async function readEvents(res: Response, count: number): Promise<Record<string, unknown>[]> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const events: Record<string, unknown>[] = []
  while (events.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const data = frame.split('\n').find((l) => l.startsWith('data: '))
      if (frame.startsWith('event: log') && data) events.push(JSON.parse(data.slice(6)))
    }
  }
  await reader.cancel()
  return events
}

describe('GET /api/sessions/:id/stream', () => {
  it('replays after_seq then streams live events', async () => {
    app = buildApp({ db: openDb(':memory:') })
    const base = `http://127.0.0.1:${await listen(app)}`

    // two pre-existing events
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { msg: 'old-1', session_id: 's1' },
        { msg: 'old-2', session_id: 's1' },
      ]),
    })

    const res = await fetch(`${base}/api/sessions/s1/stream?after_seq=1`)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // live event, sent while the stream is open
    const eventsPromise = readEvents(res, 2)
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: 'live-1', session_id: 's1' }),
    })

    const events = await eventsPromise
    expect(events.map((e) => e.msg)).toEqual(['old-2', 'live-1']) // old-1 excluded by after_seq=1
    expect(events.map((e) => e.seq)).toEqual([2, 3])
  })

  it('does not deliver events from other sessions', async () => {
    app = buildApp({ db: openDb(':memory:') })
    const base = `http://127.0.0.1:${await listen(app)}`
    const res = await fetch(`${base}/api/sessions/s1/stream`)
    const eventsPromise = readEvents(res, 1)
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ msg: 'other', session_id: 'other' }, { msg: 'mine', session_id: 's1' }]),
    })
    const events = await eventsPromise
    expect(events.map((e) => e.msg)).toEqual(['mine'])
  })
})

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ host: '127.0.0.1', port: 0 })
  const addr = app.server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  return addr.port
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/sse.test.ts`
Expected: FAIL — 404 on `/api/sessions/s1/stream` (route not defined), so `content-type` assertion fails

- [ ] **Step 3: Write the SseHub**

`packages/server/src/sse.ts`:

```ts
import type { StoredEvent } from './ingest.js'

type Listener = (events: StoredEvent[]) => void

export class SseHub {
  private listeners = new Map<string, Set<Listener>>()

  subscribe(sessionId: string, fn: Listener): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.listeners.delete(sessionId)
    }
  }

  publish(sessionId: string, events: StoredEvent[]): void {
    if (events.length === 0) return
    const set = this.listeners.get(sessionId)
    if (!set) return
    for (const fn of set) fn(events)
  }
}
```

- [ ] **Step 4: Wire hub into app.ts**

In `packages/server/src/app.ts`:

Add import:

```ts
import { SseHub } from './sse.js'
```

Replace the `afterInsert`/`setAfterInsert` scaffolding block from Task 6 (the `let afterInsert ... void setAfterInsert` lines) with:

```ts
  const hub = new SseHub()
  const afterInsert = (events: StoredEvent[]): void => {
    const bySession = new Map<string, StoredEvent[]>()
    for (const ev of events) {
      const list = bySession.get(ev.session_id)
      if (list) list.push(ev)
      else bySession.set(ev.session_id, [ev])
    }
    for (const [sid, list] of bySession) hub.publish(sid, list)
  }
```

(Move it ABOVE the `app.post('/v1/log', ...)` route so `afterInsert` is defined before use.)

Add the stream route (before `return app`):

```ts
  app.get('/api/sessions/:id/stream', (req, reply) => {
    const { id } = req.params as { id: string }
    const q = req.query as Record<string, unknown>
    const afterSeq = num(q.after_seq) ?? 0

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })

    let lastSeq = afterSeq
    const write = (ev: StoredEvent): void => {
      if (ev.seq <= lastSeq) return
      reply.raw.write(`event: log\ndata: ${JSON.stringify(ev)}\n\n`)
      lastSeq = ev.seq
    }

    // Subscribe before replay; ingest and replay are both synchronous on this
    // event loop, so nothing can interleave, and the seq guard in write()
    // makes any overlap harmless anyway.
    const unsubscribe = hub.subscribe(id, (events) => {
      for (const ev of events) write(ev)
    })

    let after = afterSeq
    for (;;) {
      const { events, next_after_seq } = queryEvents(db, id, { after_seq: after, limit: 5000 })
      for (const ev of events) write(ev)
      if (next_after_seq === null) break
      after = next_after_seq
    }

    const hb = setInterval(() => reply.raw.write(': hb\n\n'), 15_000)
    req.raw.on('close', () => {
      clearInterval(hb)
      unsubscribe()
    })
  })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/sse.test.ts packages/server/test/api.test.ts`
Expected: PASS (14 tests — SSE tests plus no regressions in api tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: SSE live tail with seq-based lossless resume"
```

---

### Task 8: Retention + server entrypoint

**Files:**
- Create: `packages/server/src/retention.ts`, `packages/server/src/index.ts`
- Test: `packages/server/test/retention.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), `buildApp` (Task 6/7)
- Produces:
  - `pruneSessions(db: Db, retentionDays: number, now: number): number` — deletes whole sessions (events + row) with `last_ts` older than the cutoff; returns count; `retentionDays <= 0` → no-op
  - `packages/server/src/index.ts` — the `npm start` entrypoint: env config, `openDb`, `buildApp`, static `public/` if present, prune at startup + hourly (unref'd interval), listen on `127.0.0.1`

- [ ] **Step 1: Write the failing test**

`packages/server/test/retention.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/retention.test.ts`
Expected: FAIL — cannot resolve `../src/retention.js`

- [ ] **Step 3: Write the implementation**

`packages/server/src/retention.ts`:

```ts
import type { Db } from './db.js'

const DAY_MS = 86_400_000

/** Deletes whole sessions (never partial) whose last event is older than the
    cutoff. Returns the number of sessions removed. */
export function pruneSessions(db: Db, retentionDays: number, now: number): number {
  if (retentionDays <= 0) return 0
  const cutoff = now - retentionDays * DAY_MS
  const ids = (db.prepare('SELECT id FROM sessions WHERE last_ts < ?').all(cutoff) as { id: string }[]).map(
    (r) => r.id,
  )
  if (ids.length === 0) return 0
  const run = db.transaction((sids: string[]) => {
    const delEvents = db.prepare('DELETE FROM events WHERE session_id = ?')
    const delSession = db.prepare('DELETE FROM sessions WHERE id = ?')
    for (const sid of sids) {
      delEvents.run(sid)
      delSession.run(sid)
    }
  })
  run(ids)
  return ids.length
}
```

`packages/server/src/index.ts`:

```ts
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fastifyStatic from '@fastify/static'
import { openDb } from './db.js'
import { buildApp } from './app.js'
import { pruneSessions } from './retention.js'

const PORT = Number(process.env.PORT ?? 4600)
const DB_PATH = process.env.DEBLOG_DB ?? path.join(os.homedir(), '.deblog', 'deblog.db')
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 7)

const db = openDb(DB_PATH)
const app = buildApp({ db })

const publicDir = path.join(import.meta.dirname, '..', 'public')
if (fs.existsSync(publicDir)) {
  app.register(fastifyStatic, { root: publicDir })
}

const pruned = pruneSessions(db, RETENTION_DAYS, Date.now())
if (pruned > 0) console.log(`[deblog] retention: pruned ${pruned} session(s) older than ${RETENTION_DAYS}d`)
setInterval(() => pruneSessions(db, RETENTION_DAYS, Date.now()), 3_600_000).unref()

const address = await app.listen({ host: '127.0.0.1', port: PORT })
console.log(`[deblog] listening on ${address}  (db: ${DB_PATH}, retention: ${RETENTION_DAYS}d)`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/test/retention.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Manual smoke test**

```bash
DEBLOG_DB=/tmp/deblog-smoke.db npm start &
sleep 2
curl -s localhost:4600/v1/log -d '{"msg":"here"}'          # {"accepted":1,"rejected":0}
curl -s localhost:4600/api/sessions | head -c 400           # one scratch session
kill %1
rm -f /tmp/deblog-smoke.db*
```

Expected: `202`-shaped bodies as commented; startup line prints port + db path.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: retention pruning + server entrypoint"
```

---

### Task 9: @deblog/client helper

**Files:**
- Create: `packages/client/package.json`, `packages/client/tsconfig.json`
- Create: `packages/client/src/index.ts`
- Test: `packages/client/test/client.test.ts`

**Interfaces:**
- Consumes: the HTTP contract only (POST /v1/log). No imports from server.
- Produces (the package's entire public API):
  - `initDeblog(opts: { source: string; url?: string; sessionId?: string; sessionLabel?: string; enabled?: boolean }): { sessionId: string }` — `enabled: false` leaves the module inert
  - `createLog(ns: string): Logger` where `interface Logger { debug(msg: string, ctx?: Record<string, unknown>): void; info(...): void; warn(...): void; error(...): void; withTrace(trace: string): Logger }`
  - `flush(): Promise<void>` — force-send buffered events (demo + tests use it)
  - `_resetForTests(): void` — test hook, clears module state

- [ ] **Step 1: Write package files**

`packages/client/package.json`:

```json
{
  "name": "@deblog/client",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

(Consumed as TypeScript source — fine for Vite/tsx consumers, which is what this local tool targets. `npm run build -w packages/client` emits `dist/` for plain-Node consumers; not wired into anything else.)

`packages/client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "noEmit": false,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/client/test/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initDeblog, createLog, flush, _resetForTests } from '../src/index.js'

const fetchMock = vi.fn()

beforeEach(() => {
  _resetForTests()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function sentBatches(): Record<string, unknown>[][] {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string))
}

describe('@deblog/client', () => {
  it('is a no-op before init and when disabled', async () => {
    createLog('a').info('dropped')
    initDeblog({ source: 'webapp', enabled: false })
    createLog('a').info('also dropped')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('batches events and flushes after 250ms', async () => {
    initDeblog({ source: 'webapp', sessionId: 's1', sessionLabel: 'run A' })
    const log = createLog('auth:token')
    log.debug('one', { n: 1 })
    log.error('two')
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:4600/v1/log')
    expect((init as RequestInit).method).toBe('POST')
    const batch = sentBatches()[0]
    expect(batch).toHaveLength(2)
    expect(batch[0]).toMatchObject({
      session_id: 's1',
      source: 'webapp',
      ns: 'auth:token',
      level: 'debug',
      msg: 'one',
      ctx: { n: 1 },
      session_label: 'run A', // label rides only the first event
    })
    expect(batch[1]).not.toHaveProperty('session_label')
    expect(typeof batch[0].ts).toBe('number')
  })

  it('flushes immediately at 64 buffered events', async () => {
    initDeblog({ source: 'webapp', sessionId: 's1' })
    const log = createLog('bulk')
    for (let i = 0; i < 64; i++) log.info(`m${i}`)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentBatches()[0]).toHaveLength(64)
  })

  it('withTrace binds trace onto every event', async () => {
    initDeblog({ source: 'api', sessionId: 's1' })
    const log = createLog('req').withTrace('t-42')
    log.info('handled')
    await flush()
    expect(sentBatches()[0][0]).toMatchObject({ trace: 't-42', ns: 'req' })
  })

  it('generates a sessionId when none supplied', () => {
    const { sessionId } = initDeblog({ source: 'webapp' })
    expect(sessionId).toMatch(/^[0-9a-z]+-[0-9a-z]{12}$/)
  })

  it('buffers on network failure, then drops oldest beyond 10k and reports drops', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initDeblog({ source: 'webapp', sessionId: 's1' })
    const log = createLog('spam')

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    for (let i = 0; i < 10_050; i++) log.info(`m${i}`)
    await vi.advanceTimersByTimeAsync(300)
    expect(warnSpy).toHaveBeenCalledTimes(1) // exactly one warn, not one per flush

    fetchMock.mockResolvedValue({ ok: true })
    await flush()
    const all = sentBatches().flat()
    const dropNotice = all.find((e) => e.ns === 'deblog' && e.level === 'warn')
    expect(dropNotice).toBeDefined()
    expect(dropNotice!.msg).toMatch(/dropped 50 events/)
    warnSpy.mockRestore()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/client/test/client.test.ts`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 4: Write the implementation**

`packages/client/src/index.ts`:

```ts
export type Level = 'debug' | 'info' | 'warn' | 'error'
export type Ctx = Record<string, unknown>

export interface InitOptions {
  source: string
  /** Server base URL. Default http://127.0.0.1:4600 */
  url?: string
  /** Session id. Default: generated, time-sortable. */
  sessionId?: string
  /** Human-readable label, sent once on the first event. */
  sessionLabel?: string
  /** Default true. false leaves every logger call a no-op. */
  enabled?: boolean
}

export interface Logger {
  debug(msg: string, ctx?: Ctx): void
  info(msg: string, ctx?: Ctx): void
  warn(msg: string, ctx?: Ctx): void
  error(msg: string, ctx?: Ctx): void
  withTrace(trace: string): Logger
}

interface WireEvent {
  ts: number
  session_id: string
  source: string
  ns: string
  level: Level
  msg: string
  ctx?: Ctx
  trace?: string
  session_label?: string
}

const MAX_BUFFER = 10_000
const FLUSH_MS = 250
const RETRY_MS = 1_000
const FLUSH_COUNT = 64
const MAX_BATCH = 1_000 // server-side limit per request

interface State {
  url: string
  source: string
  sessionId: string
  buffer: WireEvent[]
  dropped: number
  timer: ReturnType<typeof setTimeout> | null
  labelPending: string | undefined
  warned: boolean
  flushing: boolean
}

let state: State | null = null

export function initDeblog(opts: InitOptions): { sessionId: string } {
  if (opts.enabled === false) {
    state = null
    return { sessionId: opts.sessionId ?? '' }
  }
  state = {
    url: (opts.url ?? 'http://127.0.0.1:4600').replace(/\/+$/, ''),
    source: opts.source,
    sessionId: opts.sessionId ?? generateSessionId(),
    buffer: [],
    dropped: 0,
    timer: null,
    labelPending: opts.sessionLabel,
    warned: false,
    flushing: false,
  }
  if (typeof document !== 'undefined') {
    // pagehide + visibilitychange are the reliable teardown signals;
    // unload/beforeunload are not.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') beaconFlush()
    })
    addEventListener('pagehide', () => beaconFlush())
  } else if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('beforeExit', () => {
      void flush()
    })
  }
  return { sessionId: state.sessionId }
}

/** Time-sortable id: base36 epoch-ms + 12 random base36 chars. */
export function generateSessionId(): string {
  let r = ''
  for (let i = 0; i < 12; i++) r += Math.floor(Math.random() * 36).toString(36)
  return `${Date.now().toString(36)}-${r}`
}

export function createLog(ns: string): Logger {
  return makeLogger(ns, undefined)
}

function makeLogger(ns: string, trace: string | undefined): Logger {
  const emit =
    (level: Level) =>
    (msg: string, ctx?: Ctx): void => {
      const s = state
      if (!s) return // disabled: one boolean-ish check, no allocation
      const ev: WireEvent = { ts: Date.now(), session_id: s.sessionId, source: s.source, ns, level, msg }
      if (ctx !== undefined) ev.ctx = ctx
      if (trace !== undefined) ev.trace = trace
      enqueue(s, ev)
    }
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    withTrace: (t: string) => makeLogger(ns, t),
  }
}

function enqueue(s: State, ev: WireEvent): void {
  if (s.labelPending !== undefined) {
    ev.session_label = s.labelPending
    s.labelPending = undefined
  }
  if (s.buffer.length >= MAX_BUFFER) {
    s.buffer.shift()
    s.dropped++
  }
  s.buffer.push(ev)
  if (s.buffer.length >= FLUSH_COUNT) {
    void flush()
  } else {
    scheduleFlush(s, FLUSH_MS)
  }
}

function scheduleFlush(s: State, ms: number): void {
  if (s.timer !== null) return
  s.timer = setTimeout(() => {
    s.timer = null
    void flush()
  }, ms)
  ;(s.timer as { unref?: () => void }).unref?.()
}

/** Force-send everything buffered. Never throws. */
export async function flush(): Promise<void> {
  const s = state
  if (!s || s.flushing) return
  if (s.timer !== null) {
    clearTimeout(s.timer)
    s.timer = null
  }
  if (s.buffer.length === 0) return
  s.flushing = true
  try {
    while (s.buffer.length > 0) {
      const batch = s.buffer.slice(0, MAX_BATCH)
      const res = await fetch(`${s.url}/v1/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (!res.ok) throw new Error(`server responded ${res.status}`)
      s.buffer.splice(0, batch.length)
      s.warned = false
      if (s.dropped > 0) {
        const n = s.dropped
        s.dropped = 0
        s.buffer.push({
          ts: Date.now(),
          session_id: s.sessionId,
          source: s.source,
          ns: 'deblog',
          level: 'warn',
          msg: `dropped ${n} events (client buffer full while server unreachable)`,
        })
      }
    }
  } catch (err) {
    if (!s.warned) {
      s.warned = true
      console.warn(`[deblog] log server unreachable, buffering (drop-oldest beyond ${MAX_BUFFER}):`, (err as Error).message)
    }
    scheduleFlush(s, RETRY_MS) // events stay buffered; retry later
  } finally {
    s.flushing = false
  }
}

function beaconFlush(): void {
  const s = state
  if (!s || s.buffer.length === 0) return
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
  // A string body is a "simple" text/plain request — no CORS preflight, which
  // sendBeacon cannot perform. The server parses text/plain as JSON for this.
  const batch = s.buffer.splice(0, MAX_BATCH)
  navigator.sendBeacon(`${s.url}/v1/log`, JSON.stringify(batch))
}

/** Test hook: clear module state. */
export function _resetForTests(): void {
  if (state?.timer != null) clearTimeout(state.timer)
  state = null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/client/test/client.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Typecheck everything, run full suite**

```bash
npm run typecheck
npm test
```

Expected: typecheck clean; all suites pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: @deblog/client — batching, drop-oldest, sendBeacon unload flush"
```

---

### Task 10: Demo script (end-to-end)

**Files:**
- Create: `examples/demo.ts`

**Interfaces:**
- Consumes: `openDb`, `buildApp` (server, via relative import); `initDeblog`, `createLog`, `flush` (client); HTTP API via fetch
- Produces: `npm run demo` — starts a server on `PORT` (default 4600) against the real default DB, emits a realistic two-source session (`webapp` via the client helper, `api` via raw HTTP — proving both paths), verifies it back over HTTP, prints curl examples. `--keep` leaves the server running. Exit code 0 = all checks passed.

- [ ] **Step 1: Write the demo**

`examples/demo.ts`:

```ts
/**
 * deblog demo: emits a realistic two-source debug session and verifies it
 * back over the HTTP API. Usage:
 *   npm run demo            # emit, verify, exit
 *   npm run demo -- --keep  # leave the server running to browse
 */
import os from 'node:os'
import path from 'node:path'
import { openDb } from '../packages/server/src/db.js'
import { buildApp } from '../packages/server/src/app.js'
import { initDeblog, createLog, flush } from '../packages/client/src/index.js'

const PORT = Number(process.env.PORT ?? 4600)
const DB_PATH = process.env.DEBLOG_DB ?? path.join(os.homedir(), '.deblog', 'deblog.db')
const BASE = `http://127.0.0.1:${PORT}`
const KEEP = process.argv.includes('--keep')

const db = openDb(DB_PATH)
const app = buildApp({ db })
await app.listen({ host: '127.0.0.1', port: PORT })
console.log(`server up at ${BASE} (db: ${DB_PATH})`)

// ---- emit: webapp source via @deblog/client -------------------------------
const { sessionId } = initDeblog({
  source: 'webapp',
  sessionLabel: 'demo: checkout flow',
  url: BASE,
})
console.log(`session: ${sessionId}`)

const nav = createLog('nav')
const auth = createLog('auth:token')
const cart = createLog('cart')

// The client helper stamps ts itself, so webapp events cluster around "now";
// api events (sent raw) are backdated across a ~30s window for realistic spread.
let clock = Date.now() - 30_000
const tick = (ms: number): number => (clock += ms)

nav.info('page loaded', { path: '/checkout' })
auth.debug('token found in storage', { exp_in_s: 3542 })
auth.debug('token validated')
for (let i = 0; i < 20; i++) nav.debug(`route probe ${i}`, { idx: i })
cart.info('cart hydrated', { items: 3, total_cents: 8497 })
cart.warn('price changed since last view', { sku: 'SKU-771', old: 2799, new: 2999 })

const reqTrace = `req-${sessionId.slice(0, 6)}-pay`
const payLog = createLog('cart:payment').withTrace(reqTrace)
payLog.info('submitting payment', { provider: 'stripe' })
payLog.error('payment request failed', { status: 502, attempt: 1 })
payLog.error('payment request failed', { status: 502, attempt: 2 })
payLog.warn('falling back to retry queue')

await flush()

// ---- emit: api source via raw HTTP (the curl-equivalent path) --------------
async function post(events: unknown): Promise<void> {
  const res = await fetch(`${BASE}/v1/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(events),
  })
  if (res.status !== 202) throw new Error(`ingest failed: ${res.status}`)
}

const apiEvents: Record<string, unknown>[] = []
const api = (ns: string, level: string, msg: string, ctx?: unknown, trace?: string): void => {
  apiEvents.push({ session_id: sessionId, source: 'api', ns, level, msg, ts: tick(120), ctx, trace })
}

api('http', 'info', 'GET /api/cart 200', { ms: 12 })
for (let i = 0; i < 40; i++) api('db.pool', 'debug', `connection checkout ${i}`, { pool: 'main', free: 8 - (i % 4) })
api('http', 'info', 'POST /api/checkout 200', { ms: 45 })
api('payment.stripe', 'info', 'creating payment intent', { amount_cents: 8497 }, reqTrace)
api('payment.stripe', 'error', 'upstream 502 from stripe', { attempt: 1, latency_ms: 3021 }, reqTrace)
api('payment.stripe', 'error', 'upstream 502 from stripe', { attempt: 2, latency_ms: 3007 }, reqTrace)
api('payment.queue', 'warn', 'payment enqueued for retry', { queue_depth: 1 }, reqTrace)
for (let i = 0; i < 30; i++) api('http', 'debug', `GET /api/poll 200`, { ms: 3 + (i % 5) })

for (let i = 0; i < apiEvents.length; i += 25) await post(apiEvents.slice(i, i + 25))

// ---- verify over HTTP -------------------------------------------------------
let failures = 0
function check(name: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

const session = (await (await fetch(`${BASE}/api/sessions/${sessionId}`)).json()) as Record<string, unknown>
check('session exists with label', session.label === 'demo: checkout flow')
check('both sources recorded', JSON.stringify(session.sources) === '["api","webapp"]')
check('event_count = 105', session.event_count === 105)
check('error_count = 4', session.error_count === 4)

const errs = (await (await fetch(`${BASE}/api/sessions/${sessionId}/events?level=error`)).json()) as {
  events: unknown[]
}
check('4 error events queryable', errs.events.length === 4)

const traced = (await (
  await fetch(`${BASE}/api/sessions/${sessionId}/events?trace=${reqTrace}`)
).json()) as { events: { source: string }[] }
check('trace correlates across sources', new Set(traced.events.map((e) => e.source)).size === 2)

const nsFiltered = (await (
  await fetch(`${BASE}/api/sessions/${sessionId}/events?ns=payment.*`)
).json()) as { events: unknown[] }
check('ns wildcard payment.* matches 4', nsFiltered.events.length === 4)

const ndjson = await (await fetch(`${BASE}/api/sessions/${sessionId}/export.ndjson`)).text()
check('ndjson export has 105 lines', ndjson.trim().split('\n').length === 105)

console.log(`
Explore it yourself:
  curl '${BASE}/api/sessions'
  curl '${BASE}/api/sessions/${sessionId}/events?level=error'
  curl '${BASE}/api/sessions/${sessionId}/events?ns=payment.*,cart:*'
  curl '${BASE}/api/sessions/${sessionId}/events?trace=${reqTrace}'
  curl '${BASE}/api/sessions/${sessionId}/export.ndjson'
  curl -N '${BASE}/api/sessions/${sessionId}/stream'
`)

if (KEEP) {
  console.log('server still running (--keep). Ctrl-C to stop.')
} else {
  await app.close()
  process.exit(failures === 0 ? 0 : 1)
}
```

Event count arithmetic behind the checks: webapp = 1 nav.info + 2 auth.debug + 20 nav.debug + 1 cart.info + 1 cart.warn + 4 payment = 29. api = 1 http.info + 40 db.pool + 1 http.info + 3 payment.stripe + 1 payment.queue + 30 http.debug = 76. Total 105. Errors: 2 webapp + 2 api = 4. `payment.*` matches the 4 api payment events (`cart:payment` on webapp does not match). If you change the emit code, recount and update the checks to match.

- [ ] **Step 2: Run the demo**

```bash
DEBLOG_DB=/tmp/deblog-demo.db npm run demo
```

Expected: `PASS` on every check, exit 0. If a count check fails, fix the expected number in the check (count the emit code), not the emit code.

- [ ] **Step 3: Run it against the real default DB (this becomes the Phase 3 reference session)**

```bash
npm run demo
```

Expected: all PASS; session persisted in `~/.deblog/deblog.db`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: two-source demo script doubling as e2e smoke test"
```

---

### Task 11: API.md (frozen contract) + README

**Files:**
- Create: `API.md`
- Create: `README.md`

**Interfaces:**
- Consumes: the implemented behavior of Tasks 6–7 (document what IS, verified against tests)
- Produces: the frozen contract the Phase 3/4 UI is built against, and the agent-facing docs

- [ ] **Step 1: Write API.md**

Document exactly (verify each item against `app.ts` and the tests while writing — the code is the source of truth, API.md must not drift):

- `POST /v1/log` — body forms (single object / array), full event field table (`msg` required; `ts`, `session_id`, `source`, `ns`, `level`, `ctx`, `trace`, `session_label` optional) with defaults and coercions; `202 {accepted, rejected}`; `400` (single invalid / malformed JSON); `413` (batch > 1000 or body > 5MB); `content-type: application/json` or `text/plain` (parsed as JSON); the minimal curl example.
- `GET /api/sessions?limit=&offset=` — SessionSummary field table (`id, label, first_ts, last_ts, duration_ms, status, event_count, error_count, warn_count, sources`), `status` semantics (active = last event within 60s).
- `GET /api/sessions/:id` — same shape, `404`.
- `GET /api/sessions/:id/events` — every filter param (`ns` comma-OR wildcard w/ `*`, `level` comma-OR, `source` comma-OR, `trace`, `q`, `from_ts`, `to_ts`, `after_seq`, `before_seq`, `limit` default 500 max 10000), AND across params; response `{events, next_after_seq}`; **ordering seq ASC**; StoredEvent field table (`seq, session_id, ts, received_at, source, ns, level, msg, ctx, trace`).
- `GET /api/sessions/:id/export.ndjson` — same filters, one StoredEvent JSON per line.
- `GET /api/sessions/:id/stream?after_seq=N` — SSE frame format (`event: log` / `data: <StoredEvent JSON>`), heartbeat `: hb` every 15s, resume semantics.
- `DELETE /api/sessions/:id` — `204` / `404`.
- Header: "This contract is FROZEN as of Phase 2. The UI is built strictly against this document. Changes require a version note here."

- [ ] **Step 2: Write README.md**

Sections:
1. **What is this** — 3 sentences (local log server, sessions in SQLite, web UI later).
2. **Quickstart** — `npm install && npm start`; the minimal curl; `npm run demo -- --keep`.
3. **Logging from your app** — `@deblog/client` usage (init/createLog/withTrace snippet from Task 9's interface block) + "any language: it's just HTTP POST" with a curl batch example.
4. **For AI coding agents** — written for an agent debugging an app that logs to deblog:
   - Server runs at `http://127.0.0.1:4600`; check liveness with `GET /api/health`.
   - Find the relevant session: `curl -s localhost:4600/api/sessions` — newest first; look at `label`, `sources`, `error_count`, `status` (`active` = still receiving events).
   - Read it: `GET /api/sessions/:id/events?level=error` first, then widen (`level=warn,error`, ns wildcards like `ns=auth:*`, `q=` text search, `trace=` to follow one request across sources).
   - Bulk analysis: `GET /api/sessions/:id/export.ndjson` — one JSON object per line, pipe-friendly.
   - Pagination: responses are `seq ASC`; pass `next_after_seq` back as `after_seq`. Events include both `ts` (client clock) and `received_at`/`seq` (server order) — trust `seq` for ordering.
5. **Configuration** — env var table (`PORT`, `DEBLOG_DB`, `RETENTION_DAYS`) and retention semantics.

- [ ] **Step 3: Verify docs against reality**

```bash
npm test
DEBLOG_DB=/tmp/deblog-doccheck.db npm start &
sleep 2
# spot-check 3 API.md claims:
curl -s localhost:4600/v1/log -d '{"msg":"x","level":"bogus"}'   # {"accepted":1,"rejected":0}
curl -si localhost:4600/api/sessions/nope | head -1               # 404
curl -s 'localhost:4600/api/sessions/scratch-'$(date -u +%F)'/events?level=info' | head -c 300  # coerced event, ctx._level:"bogus"
kill %1; rm -f /tmp/deblog-doccheck.db*
```

Expected: outputs match what API.md documents.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: freeze API contract (API.md) + README with agent guide"
```

---

## Phase 2 exit criteria (all must hold before STOP-for-review)

1. `npm test` — all suites green.
2. `npm run typecheck` — clean.
3. `npm run demo` — all PASS, exit 0; demo session persisted in `~/.deblog/deblog.db` for Phase 3.
4. `API.md` matches implemented behavior (Task 11 Step 3 spot-checks).
5. Every task committed separately.
