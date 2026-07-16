# logsafe Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plugin system so domain-specific log *types* can override the session list row, the session detail view, and (optionally) ingest shaping + derived metrics + their own API routes — without forking core.

**Architecture:** Three groups. **Group 1** builds a standalone `@coglet/logsafe-plugin-sdk` package (server + ui subpaths) that both core and future external plugins depend on. **Group 2** threads a per-event `type` through ingest/storage, loads server plugins at runtime from config, and wires ingest/route/delete hooks. **Group 3** makes the SPA resolve a per-session "view owner" plugin at build time, exposes `FlatLogView`/`useSessionEvents` to plugins via a React context, and ends with a working "hello" plugin proving the whole contract. Each group ends with green tests and working software.

**Tech Stack:** TypeScript (NodeNext, strict), Fastify 5, better-sqlite3, React 19, react-router-dom 7, Vite 8, Vitest 4, `@testing-library/react` + jsdom.

## Global Constraints

- **Node** `>=20`; ESM only (`"type": "module"` everywhere).
- **Design doc:** `docs/superpowers/specs/2026-07-14-plugin-system-design.md` — the frozen contract. Interface names/types below must match it verbatim.
- **API additions are additive + versioned.** `API.md` says FROZEN; the amendment (Task 15) adds a dated note, never mutates existing field semantics.
- **Tests:** `npm test` runs Vitest from repo root. Run one file with `npx vitest run <path>`; filter with `-t "<name>"`. React tests MUST start with `// @vitest-environment jsdom` (global env is `node`).
- **Typecheck:** `npm run typecheck` must stay green (`tsc -p packages/server && tsc -p packages/client --noEmit && tsc -p ui --noEmit`).
- **SDK package name:** `@coglet/logsafe-plugin-sdk` (matches the `@coglet` scope used by `packages/server`).
- **Plugin contract version:** `PLUGIN_API_VERSION = '1'`. A plugin whose manifest `apiVersion` major ≠ `1` is skipped with a logged reason.
- **Plugin table naming:** every plugin-owned table is `plugin_<id>_<name>`, built via `PluginDb.table(name)`. Plugins read core tables but write only their own.
- **Commit after every task.** End messages with the repo's `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

**Group 1 — SDK (new package `packages/plugin-sdk`)**
- `packages/plugin-sdk/package.json` — workspace package, subpath exports `./server`, `./ui`.
- `packages/plugin-sdk/tsconfig.json` — extends base.
- `packages/plugin-sdk/src/server.ts` — server contract types + `PLUGIN_API_VERSION`.
- `packages/plugin-sdk/src/ui.tsx` — ui contract types + `LogsafeRuntimeProvider`/`useSessionEvents`/`FlatLogView`/`useCoreApi`/`usePluginFetch`.
- `packages/plugin-sdk/test/server.test.ts`, `packages/plugin-sdk/test/ui.test.tsx`.

**Group 2 — Server**
- Modify: `db.ts`, `normalize.ts`, `ingest.ts`, `queries.ts`, `retention.ts`, `app.ts`, `serve.ts`.
- New: `packages/server/src/plugins/context.ts` (PluginDb + context), `loader.ts` (config discovery), `pipeline.ts` (classify/transform/afterInsert).
- New test fixtures: `packages/server/test/fixtures/plugin-foo/` (a fake plugin).
- Modify: `API.md`.

**Group 3 — Client**
- Modify: `ui/src/api.ts`, `ui/src/routes/SessionListPage.tsx`, `ui/src/routes/SessionDetailPage.tsx`, `ui/src/main.tsx`, `vitest.config.ts`, root `package.json`.
- New: `ui/src/components/FlatLogView.tsx`, `ui/src/components/DefaultSessionRow.tsx`, `ui/src/plugins/registry.ts`, `ui/src/plugins.generated.ts`, `ui/src/runtime.tsx`, `scripts/plugins-sync.mjs`.
- New acceptance: `examples/plugin-hello/` + `ui/src/test/pluginResolution.test.tsx`.

---

# Group 1 — SDK package

### Task 1: Scaffold `@coglet/logsafe-plugin-sdk` + server contract types

**Files:**
- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/tsconfig.json`
- Create: `packages/plugin-sdk/src/server.ts`
- Test: `packages/plugin-sdk/test/server.test.ts`

**Interfaces:**
- Produces (from `@coglet/logsafe-plugin-sdk/server`): `PLUGIN_API_VERSION: '1'`; types `LogLevel`, `IncomingEvent`, `StoredEvent`, `PluginDb`, `ServerPluginContext`, `PluginRouter`, `PluginRouteHandler`, `ServerPlugin`, `PluginManifest`.

- [ ] **Step 1: Create the package manifest and tsconfig**

`packages/plugin-sdk/package.json`:
```json
{
  "name": "@coglet/logsafe-plugin-sdk",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "description": "Types and runtime helpers for building logsafe plugins.",
  "exports": {
    "./server": { "types": "./src/server.ts", "default": "./src/server.ts" },
    "./ui": { "types": "./src/ui.tsx", "default": "./src/ui.tsx" }
  },
  "peerDependencies": { "react": "^19" },
  "peerDependenciesMeta": { "react": { "optional": true } },
  "devDependencies": {
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.17",
    "jsdom": "^29.1.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  }
}
```
> In-repo, exports point at TypeScript source — Vitest, tsx, and Vite all consume `.ts`/`.tsx` directly, and `tsc` resolves the `types` condition. A compiled `dist` for npm publish is a later, out-of-scope concern (noted in the design doc §12).

`packages/plugin-sdk/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx" },
  "include": ["src", "test"]
}
```

- [ ] **Step 2: Install so the workspace symlink exists**

Run: `npm install`
Expected: `@coglet/logsafe-plugin-sdk` symlinked into `node_modules/@coglet/`. No errors.

- [ ] **Step 3: Write the failing test**

`packages/plugin-sdk/test/server.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PLUGIN_API_VERSION } from '@coglet/logsafe-plugin-sdk/server'
import type { ServerPlugin, PluginManifest, IncomingEvent } from '@coglet/logsafe-plugin-sdk/server'

describe('server SDK', () => {
  it('exposes the contract version', () => {
    expect(PLUGIN_API_VERSION).toBe('1')
  })

  it('lets a plugin object satisfy the ServerPlugin type', () => {
    const manifest: PluginManifest = {
      id: 'foo', version: '0.0.1', apiVersion: '1', ownedTypes: ['foo'], priority: 5,
    }
    const plugin: ServerPlugin = {
      matchType: (e: IncomingEvent) => (e.source === 'foo' ? 'foo' : null),
    }
    expect(manifest.ownedTypes).toContain('foo')
    expect(plugin.matchType?.({ source: 'foo' } as IncomingEvent)).toBe('foo')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run packages/plugin-sdk/test/server.test.ts`
Expected: FAIL — cannot resolve `@coglet/logsafe-plugin-sdk/server` (module/exports not created yet).

- [ ] **Step 5: Write the server contract module**

`packages/plugin-sdk/src/server.ts`:
```ts
/** Plugin contract major version. Core refuses a plugin whose manifest
 *  apiVersion major differs from this. */
export const PLUGIN_API_VERSION = '1' as const

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A normalized event before insert: parsed ctx, resolved type, and the
 *  original ingest object (for matchers). */
export interface IncomingEvent {
  readonly session_id: string
  readonly ts: number
  readonly received_at: number
  readonly source: string
  readonly ns: string
  readonly level: LogLevel
  readonly msg: string
  readonly ctx: unknown
  readonly trace: string | null
  readonly type: string
  readonly raw: Readonly<Record<string, unknown>>
}

/** Post-insert event: core StoredEvent + type, seq assigned. */
export interface StoredEvent {
  readonly seq: number
  readonly session_id: string
  readonly ts: number
  readonly received_at: number
  readonly source: string
  readonly ns: string
  readonly level: LogLevel
  readonly msg: string
  readonly ctx: unknown
  readonly trace: string | null
  readonly type: string
}

/** SQLite handle scoped to one plugin. `table()` enforces the naming seam. */
export interface PluginDb {
  exec(sql: string): void
  prepare<Row = unknown>(sql: string): {
    all(...p: unknown[]): Row[]
    get(...p: unknown[]): Row | undefined
    run(...p: unknown[]): { changes: number }
  }
  transaction<T>(fn: () => T): () => T
  /** `table('views')` → `'plugin_<id>_views'`. Use for every CREATE/SELECT. */
  table(name: string): string
}

export interface ServerPluginContext {
  readonly pluginId: string
  readonly db: PluginDb
  log(msg: string): void
}

export type PluginRouteHandler = (req: {
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}) => unknown | Promise<unknown>

/** Every route is mounted at /api/plugins/<id><path>. */
export interface PluginRouter {
  get(path: string, handler: PluginRouteHandler): void
  post(path: string, handler: PluginRouteHandler): void
}

export interface ServerPlugin {
  matchType?(event: IncomingEvent): string | null
  transform?(event: IncomingEvent): IncomingEvent | void
  afterInsert?(events: StoredEvent[], ctx: ServerPluginContext): void
  migrate?(ctx: ServerPluginContext): void
  routes?(router: PluginRouter, ctx: ServerPluginContext): void
  onSessionDelete?(sessionId: string, ctx: ServerPluginContext): void
  setup?(ctx: ServerPluginContext): void | Promise<void>
  teardown?(ctx: ServerPluginContext): void | Promise<void>
}

export interface PluginManifest {
  id: string
  version: string
  apiVersion: string
  ownedTypes: string[]
  priority?: number
  /** Module specifiers for the entries, relative to the plugin package. */
  server?: string
  ui?: string
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/plugin-sdk/test/server.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-sdk package.json package-lock.json
git commit -m "feat(sdk): scaffold @coglet/logsafe-plugin-sdk with server contract types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: SDK UI contract types + runtime context/facades

**Files:**
- Create: `packages/plugin-sdk/src/ui.tsx`
- Modify: `vitest.config.ts` (add `.tsx` to the packages glob)
- Test: `packages/plugin-sdk/test/ui.test.tsx`

**Interfaces:**
- Consumes: `StoredEvent`, `LogLevel` (structural; ui re-declares its own client-facing shapes).
- Produces (from `@coglet/logsafe-plugin-sdk/ui`): types `SessionSummary`, `StoredEvent`, `EventsPage`, `CoreApi`, `PluginFetch`, `ThemeTokens`, `ListRowProps`, `DetailViewProps`, `UIPlugin`, `FlatLogViewProps`, `LogsafeRuntime`; runtime `LogsafeRuntimeProvider`, `useCoreApi`, `usePluginFetch`, `useSessionEvents`, `FlatLogView`.

- [ ] **Step 1: Allow `.test.tsx` under `packages/*` in Vitest**

Modify `vitest.config.ts` `include` array:
```ts
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/test/**/*.test.tsx',
      'ui/src/test/**/*.test.{ts,tsx}',
    ],
```

- [ ] **Step 2: Write the failing test**

`packages/plugin-sdk/test/ui.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  LogsafeRuntimeProvider, FlatLogView, useCoreApi,
  type LogsafeRuntime,
} from '@coglet/logsafe-plugin-sdk/ui'

afterEach(cleanup)

function runtime(over: Partial<LogsafeRuntime> = {}): LogsafeRuntime {
  return {
    api: { fetchEventsPage: async () => ({ events: [], next_after_seq: null }), getSession: async () => null, exportUrl: () => '' },
    makePluginFetch: () => (async () => ({})) as never,
    FlatLogView: () => <div>REAL-FLAT</div>,
    useSessionEvents: () => ({ events: [], loading: false, tail: 'live', pause() {}, resume() {}, error: null }),
    tokens: {} as never,
    ...over,
  }
}

describe('ui SDK runtime', () => {
  it('delegates FlatLogView to the core-provided implementation', () => {
    render(
      <LogsafeRuntimeProvider value={runtime()}>
        <FlatLogView sessionId="s1" session={null} />
      </LogsafeRuntimeProvider>,
    )
    expect(screen.getByText('REAL-FLAT')).toBeTruthy()
  })

  it('throws a clear error when a facade is used with no provider', () => {
    function Probe() { useCoreApi(); return null }
    expect(() => render(<Probe />)).toThrow(/LogsafeRuntimeProvider/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/plugin-sdk/test/ui.test.tsx`
Expected: FAIL — `@coglet/logsafe-plugin-sdk/ui` has no exports yet.

- [ ] **Step 4: Write the ui contract module**

`packages/plugin-sdk/src/ui.tsx`:
```tsx
import { createContext, useContext, type ComponentType, type ReactNode } from 'react'

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

export interface StoredEvent {
  seq: number
  session_id: string
  ts: number
  received_at: number
  source: string
  ns: string
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  ctx: unknown
  trace: string | null
  type: string
}

export interface EventsPage { events: StoredEvent[]; next_after_seq: number | null }

export interface CoreApi {
  fetchEventsPage(sessionId: string, params: URLSearchParams, afterSeq?: number, limit?: number): Promise<EventsPage>
  getSession(id: string): Promise<SessionSummary | null>
  exportUrl(sessionId: string, params: URLSearchParams): string
}

export type PluginFetch = <T = unknown>(path: string, init?: RequestInit) => Promise<T>

export interface ThemeTokens {
  bg: string; bgRaise: string; txt: string; dim: string; faint: string; line: string
  phos: string; amber: string; err: string
  sources: string[]
  rowH: string
}

export interface FlatLogViewProps {
  sessionId: string
  session: SessionSummary | null
  baseFilters?: { ns?: string; level?: string; source?: string; type?: string }
}

export interface SessionEventsState {
  events: StoredEvent[]
  loading: boolean
  tail: 'live' | 'paused'
  pause(): void
  resume(): void
  error: string | null
}

export interface ListRowProps {
  session: SessionSummary
  now: number
  selected: boolean
  onOpen(): void
  onSelect(): void
  api: CoreApi
  pluginFetch: PluginFetch
}

export interface DetailViewProps {
  session: SessionSummary | null
  sessionId: string
  api: CoreApi
  pluginFetch: PluginFetch
  urlState: {
    params: URLSearchParams
    setParams(next: URLSearchParams, opts?: { replace?: boolean }): void
  }
  tokens: ThemeTokens
}

export interface UIPlugin {
  type: string
  ListRow?: ComponentType<ListRowProps>
  DetailView?: ComponentType<DetailViewProps>
}

/** What core supplies at the app root so the facades below resolve. */
export interface LogsafeRuntime {
  api: CoreApi
  makePluginFetch(pluginId: string): PluginFetch
  FlatLogView: ComponentType<FlatLogViewProps>
  useSessionEvents(sessionId: string, filters?: URLSearchParams): SessionEventsState
  tokens: ThemeTokens
}

const RuntimeContext = createContext<LogsafeRuntime | null>(null)

export function LogsafeRuntimeProvider({ value, children }: { value: LogsafeRuntime; children: ReactNode }) {
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

function useRuntime(): LogsafeRuntime {
  const rt = useContext(RuntimeContext)
  if (!rt) throw new Error('logsafe plugin UI must render inside <LogsafeRuntimeProvider>')
  return rt
}

export function useCoreApi(): CoreApi { return useRuntime().api }
export function useThemeTokens(): ThemeTokens { return useRuntime().tokens }
export function usePluginFetch(pluginId: string): PluginFetch { return useRuntime().makePluginFetch(pluginId) }
export function useSessionEvents(sessionId: string, filters?: URLSearchParams): SessionEventsState {
  return useRuntime().useSessionEvents(sessionId, filters)
}
export function FlatLogView(props: FlatLogViewProps) {
  const Impl = useRuntime().FlatLogView
  return <Impl {...props} />
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/plugin-sdk/test/ui.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-sdk/src/ui.tsx packages/plugin-sdk/test/ui.test.tsx vitest.config.ts
git commit -m "feat(sdk): ui contract types + runtime context facades

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Group 2 — Server

### Task 3: Schema — add `type`/`types` columns via idempotent migration

**Files:**
- Modify: `packages/server/src/db.ts`
- Test: `packages/server/test/db.test.ts`

**Interfaces:**
- Produces: `events.type TEXT NOT NULL DEFAULT 'generic'`, `sessions.types TEXT NOT NULL DEFAULT '[]'`, index `idx_events_session_type`. `openDb()` signature unchanged.

- [ ] **Step 1: Write the failing test**

Add to `packages/server/test/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { openDb } from '../src/db.js'

describe('schema: plugin type columns', () => {
  it('adds type to events and types to sessions with defaults', () => {
    const db = openDb(':memory:')
    const eventCols = (db.prepare(`PRAGMA table_info(events)`).all() as { name: string; dflt_value: string }[])
    const typeCol = eventCols.find((c) => c.name === 'type')
    expect(typeCol).toBeTruthy()
    const sessionCols = (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[])
    expect(sessionCols.some((c) => c.name === 'types')).toBe(true)
  })

  it('upgrades a pre-existing db that lacks the columns', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts INTEGER NOT NULL, received_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'default', ns TEXT NOT NULL DEFAULT '', level TEXT NOT NULL, msg TEXT NOT NULL, ctx TEXT, trace TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT, first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL, event_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, warn_count INTEGER NOT NULL DEFAULT 0, sources TEXT NOT NULL DEFAULT '[]');
      INSERT INTO sessions (id, first_ts, last_ts) VALUES ('old', 1, 1);`)
    // Re-run migrations against the same file handle as openDb would.
    const { migrateSchema } = require('../src/db.js') as { migrateSchema: (d: Database.Database) => void }
    migrateSchema(db)
    const row = db.prepare(`SELECT types FROM sessions WHERE id = 'old'`).get() as { types: string }
    expect(row.types).toBe('[]')
  })
})
```
> `migrateSchema` is exported specifically so the "upgrade an old db" path is unit-testable without touching disk.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/db.test.ts -t "plugin type columns"`
Expected: FAIL — `type`/`types` columns absent; `migrateSchema` not exported.

- [ ] **Step 3: Implement the migration**

Rewrite `packages/server/src/db.ts` (keep the existing `SCHEMA`, add migration):
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
```
> Change the failing test's `require` to a static import if the runtime rejects CJS `require` in ESM: replace `const { migrateSchema } = require(...)` with a top-level `import { migrateSchema } from '../src/db.js'` added to the existing import line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/db.test.ts`
Expected: PASS (all, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db.ts packages/server/test/db.test.ts
git commit -m "feat(server): additive type/types columns + idempotent migrateSchema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Thread `type` through normalize → ingest → queries (explicit field only)

**Files:**
- Modify: `packages/server/src/normalize.ts`, `packages/server/src/ingest.ts`, `packages/server/src/queries.ts`
- Test: `packages/server/test/ingest.test.ts`, `packages/server/test/queries.test.ts`

**Interfaces:**
- Produces: `NormalizedEvent.type: string` (set from explicit `raw.type`, else `'generic'`); `StoredEvent.type: string`; `SessionSummary.types: string[]`; `insertBatch` writes `type` and maintains `sessions.types`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/test/ingest.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'
import { normalizeEvent } from '../src/normalize.js'
import { insertBatch } from '../src/ingest.js'

describe('ingest: event type', () => {
  it('stores explicit type and derives the session types set', () => {
    const db = openDb(':memory:')
    const t = 1000
    const evs = [
      normalizeEvent({ msg: 'a', session_id: 's1', type: 'psdk' }, t),
      normalizeEvent({ msg: 'b', session_id: 's1' }, t),
    ].filter((e): e is NonNullable<typeof e> => e !== null)
    const stored = insertBatch(db, evs)
    expect(stored.map((e) => e.type).sort()).toEqual(['generic', 'psdk'])
    const row = db.prepare(`SELECT types FROM sessions WHERE id = 's1'`).get() as { types: string }
    expect(JSON.parse(row.types)).toEqual(['generic', 'psdk'])
  })
})
```

Add to `packages/server/test/queries.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'
import { normalizeEvent } from '../src/normalize.js'
import { insertBatch } from '../src/ingest.js'
import { queryEvents, getSession } from '../src/queries.js'

describe('queries: type surfaced', () => {
  it('returns type on events and types[] on the session', () => {
    const db = openDb(':memory:')
    const ev = normalizeEvent({ msg: 'a', session_id: 's1', type: 'psdk' }, 5)!
    insertBatch(db, [ev])
    expect(queryEvents(db, 's1', {}).events[0].type).toBe('psdk')
    expect(getSession(db, 's1', 10)!.types).toEqual(['psdk'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/test/ingest.test.ts packages/server/test/queries.test.ts -t type`
Expected: FAIL — `type`/`types` not present on the produced objects.

- [ ] **Step 3: Add `type` to `NormalizedEvent`**

In `packages/server/src/normalize.ts`, add to the `NormalizedEvent` interface (after `session_label`):
```ts
  type: string
```
And in the returned object of `normalizeEvent`, add:
```ts
    type: str(r.type) ?? 'generic',
```
> `str()` already returns non-empty-string-or-null, so a non-empty `type` field is used verbatim, everything else defaults to `'generic'`. This implements rule 1 (explicit type) of design §2.2; matchers (rule 2) are layered on in Task 7.

- [ ] **Step 4: Write `type` in `insertBatch` and maintain `sessions.types`**

In `packages/server/src/ingest.ts`:
- Add `type: string` to the `StoredEvent` interface.
- Change the `insertEvent` SQL to include `type`:
```ts
  const insertEvent = db.prepare(`
    INSERT INTO events (session_id, ts, received_at, source, ns, level, msg, ctx, trace, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
```
- Read the session's existing `types` alongside `sources`:
```ts
  const getSession = db.prepare('SELECT sources, types FROM sessions WHERE id = ?')
```
- Add `types = ?` to the `updateSession` SQL (mirror `sources`):
```ts
      sources = ?,
      types = ?
```
- Inside the per-session loop, after `const sources = new Set<string>(...)` add:
```ts
      const types = new Set<string>(JSON.parse(row.types))
```
- In the per-event loop, after `sources.add(e.source)` add `types.add(e.type)`, pass `e.type` as the last bind param to `insertEvent.run(...)`, and add `type: e.type` to the pushed `StoredEvent`.
- In the `updateSession.run(...)` call, add the serialized types before `sessionId`:
```ts
      updateSession.run(label, minTs, maxTs, list.length, errors, warns,
        JSON.stringify([...sources].sort()), JSON.stringify([...types].sort()), sessionId)
```

- [ ] **Step 5: Surface `type`/`types` in `queries.ts`**

In `packages/server/src/queries.ts`:
- Add `type: string` to `EventRow` and ensure `rowToEvent` carries it (spread `...row` already includes it once the column exists — verify `StoredEvent` import now has `type`).
- Add `types: string[]` to `SessionSummary`.
- Add `types: string` to `SessionRow`.
- In `rowToSession`, add `types: JSON.parse(row.types)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/ingest.test.ts packages/server/test/queries.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS. (The UI's `ui/src/api.ts` still lacks `type`/`types` but its tests build their own fixtures, so nothing breaks yet.)

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/normalize.ts packages/server/src/ingest.ts packages/server/src/queries.ts packages/server/test/ingest.test.ts packages/server/test/queries.test.ts
git commit -m "feat(server): carry event type through ingest, derive session types[]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `PluginDb` + `ServerPluginContext` implementation

**Files:**
- Create: `packages/server/src/plugins/context.ts`
- Test: `packages/server/test/plugin-context.test.ts`

**Interfaces:**
- Consumes: `PluginDb`, `ServerPluginContext` (SDK/server), `Db` (core).
- Produces: `makePluginContext(db: Db, pluginId: string): ServerPluginContext`; the returned `ctx.db.table('x')` → `plugin_<id>_x`.

- [ ] **Step 1: Write the failing test**

`packages/server/test/plugin-context.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'
import { makePluginContext } from '../src/plugins/context.js'

describe('plugin context', () => {
  it('namespaces table names and can create/query a plugin table', () => {
    const db = openDb(':memory:')
    const ctx = makePluginContext(db, 'psdk')
    expect(ctx.pluginId).toBe('psdk')
    expect(ctx.db.table('views')).toBe('plugin_psdk_views')
    ctx.db.exec(`CREATE TABLE ${ctx.db.table('views')} (session_id TEXT, vst REAL)`)
    ctx.db.prepare(`INSERT INTO ${ctx.db.table('views')} VALUES (?, ?)`).run('s1', 1.2)
    const row = ctx.db.prepare(`SELECT vst FROM ${ctx.db.table('views')} WHERE session_id = ?`).get('s1') as { vst: number }
    expect(row.vst).toBe(1.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-context.test.ts`
Expected: FAIL — `../src/plugins/context.js` does not exist.

- [ ] **Step 3: Implement the context**

`packages/server/src/plugins/context.ts`:
```ts
import type { Db } from '../db.js'
import type { PluginDb, ServerPluginContext } from '@coglet/logsafe-plugin-sdk/server'

/** A PluginDb is just the core better-sqlite3 handle plus a `table()` helper
 *  that enforces the `plugin_<id>_` prefix. SQLite has no per-schema
 *  isolation in one file, so this is a naming seam, not a sandbox. */
function makePluginDb(db: Db, pluginId: string): PluginDb {
  return {
    exec: (sql) => db.exec(sql),
    prepare: <Row = unknown>(sql: string) => db.prepare(sql) as unknown as PluginDb['prepare'] extends never ? never : ReturnType<PluginDb['prepare']> & { all(...p: unknown[]): Row[] },
    transaction: <T>(fn: () => T) => db.transaction(fn),
    table: (name: string) => `plugin_${pluginId}_${name}`,
  } as PluginDb
}

export function makePluginContext(db: Db, pluginId: string): ServerPluginContext {
  return {
    pluginId,
    db: makePluginDb(db, pluginId),
    log: (msg: string) => console.log(`[logsafe:plugin:${pluginId}] ${msg}`),
  }
}
```
> If the `prepare` cast reads awkwardly to the type checker, simplify to `prepare: (sql: string) => db.prepare(sql) as never,` — the SDK's `PluginDb.prepare` shape is structurally satisfied by better-sqlite3's statement at runtime; the cast only silences the generic mismatch.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/test/plugin-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add packages/server/src/plugins/context.ts packages/server/test/plugin-context.test.ts
git commit -m "feat(server): PluginDb + ServerPluginContext with table() namespacing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Plugin loader (config discovery, apiVersion gate, priority sort, migrate/setup)

**Files:**
- Create: `packages/server/src/plugins/loader.ts`
- Create fixtures: `packages/server/test/fixtures/plugin-foo/package.json`, `packages/server/test/fixtures/plugin-foo/server.js`
- Test: `packages/server/test/plugin-loader.test.ts`

**Interfaces:**
- Consumes: `ServerPlugin`, `PluginManifest`, `PLUGIN_API_VERSION` (SDK); `makePluginContext` (Task 5); `Db`.
- Produces:
  - `interface LoadedServerPlugin { manifest: PluginManifest; plugin: ServerPlugin; ctx: ServerPluginContext }`
  - `async function loadServerPlugins(db: Db, specifiers: string[], resolveDir: string): Promise<LoadedServerPlugin[]>` — resolves each specifier's `package.json#logsafe`, skips apiVersion-major mismatches (logs), dynamic-imports the `server` entry, runs `migrate` then `await setup`, returns the list **sorted by `priority` desc (default 0), ties by input order**.

- [ ] **Step 1: Create the fixture plugin**

`packages/server/test/fixtures/plugin-foo/package.json`:
```json
{
  "name": "plugin-foo",
  "version": "0.0.1",
  "type": "module",
  "logsafe": {
    "id": "foo", "apiVersion": "1", "ownedTypes": ["foo"], "priority": 10,
    "server": "./server.js"
  }
}
```
`packages/server/test/fixtures/plugin-foo/server.js`:
```js
/** @type {import('@coglet/logsafe-plugin-sdk/server').ServerPlugin} */
const plugin = {
  matchType: (e) => (e.source === 'foo' ? 'foo' : null),
  migrate: (ctx) => { ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('marks')} (session_id TEXT, seq INTEGER)`) },
  afterInsert: (events, ctx) => {
    const ins = ctx.db.prepare(`INSERT INTO ${ctx.db.table('marks')} VALUES (?, ?)`)
    for (const e of events) ins.run(e.session_id, e.seq)
  },
  onSessionDelete: (sessionId, ctx) => { ctx.db.prepare(`DELETE FROM ${ctx.db.table('marks')} WHERE session_id = ?`).run(sessionId) },
  routes: (r) => { r.get('/marks/:session', (req) => ({ session: req.params.session })) },
}
export default plugin
```

- [ ] **Step 2: Write the failing test**

`packages/server/test/plugin-loader.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('plugin loader', () => {
  it('loads a fixture plugin, runs migrate, and exposes its hooks', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].manifest.id).toBe('foo')
    expect(typeof loaded[0].plugin.matchType).toBe('function')
    // migrate created the plugin table:
    const tbl = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_foo_marks'`).get())
    expect(tbl).toBeTruthy()
  })

  it('skips a plugin whose apiVersion major does not match', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-foo'], FIX, { apiVersion: '2' })
    expect(loaded).toHaveLength(0)
  })
})
```
> The optional 4th arg `{ apiVersion }` overrides the accepted major so the skip path is testable without a second fixture.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-loader.test.ts`
Expected: FAIL — `../src/plugins/loader.js` does not exist.

- [ ] **Step 4: Implement the loader**

`packages/server/src/plugins/loader.ts`:
```ts
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Db } from '../db.js'
import type { ServerPlugin, PluginManifest, ServerPluginContext } from '@coglet/logsafe-plugin-sdk/server'
import { PLUGIN_API_VERSION } from '@coglet/logsafe-plugin-sdk/server'
import { makePluginContext } from './context.js'

export interface LoadedServerPlugin {
  manifest: PluginManifest
  plugin: ServerPlugin
  ctx: ServerPluginContext
}

function major(v: string): string { return v.split('.')[0] }

/** Resolve a module specifier's package.json relative to `resolveDir`. */
function resolvePackageJson(specifier: string, resolveDir: string): { dir: string; pkg: Record<string, unknown> } {
  const req = createRequire(pathToFileURL(path.join(resolveDir, 'noop.js')))
  const pkgPath = req.resolve(`${specifier}/package.json`)
  const pkg = req(`${specifier}/package.json`) as Record<string, unknown>
  return { dir: path.dirname(pkgPath), pkg }
}

export async function loadServerPlugins(
  db: Db,
  specifiers: string[],
  resolveDir: string,
  opts: { apiVersion?: string } = {},
): Promise<LoadedServerPlugin[]> {
  const accept = opts.apiVersion ?? PLUGIN_API_VERSION
  const loaded: (LoadedServerPlugin & { _order: number })[] = []

  for (let i = 0; i < specifiers.length; i++) {
    const specifier = specifiers[i]
    let dir: string, pkg: Record<string, unknown>
    try {
      ({ dir, pkg } = resolvePackageJson(specifier, resolveDir))
    } catch {
      console.warn(`[logsafe] plugin "${specifier}" not resolvable; skipping`)
      continue
    }
    const manifest = pkg.logsafe as PluginManifest | undefined
    if (!manifest?.id) {
      console.warn(`[logsafe] plugin "${specifier}" has no "logsafe" manifest; skipping`)
      continue
    }
    if (major(manifest.apiVersion) !== major(accept)) {
      console.warn(`[logsafe] plugin "${manifest.id}" targets apiVersion ${manifest.apiVersion}, core is ${accept}; skipping`)
      continue
    }
    if (!manifest.server) continue // ui-only plugin: nothing to load server-side

    const entryUrl = pathToFileURL(path.resolve(dir, manifest.server)).href
    const mod = (await import(entryUrl)) as { default?: ServerPlugin }
    const plugin = mod.default
    if (!plugin) {
      console.warn(`[logsafe] plugin "${manifest.id}" server entry has no default export; skipping`)
      continue
    }
    const ctx = makePluginContext(db, manifest.id)
    plugin.migrate?.(ctx)
    await plugin.setup?.(ctx)
    loaded.push({ manifest, plugin, ctx, _order: i })
  }

  loaded.sort((a, b) => (b.manifest.priority ?? 0) - (a.manifest.priority ?? 0) || a._order - b._order)
  return loaded.map(({ _order, ...rest }) => rest)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/plugin-loader.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add packages/server/src/plugins/loader.ts packages/server/test/fixtures packages/server/test/plugin-loader.test.ts
git commit -m "feat(server): plugin loader — config discovery, apiVersion gate, priority sort

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Ingest pipeline — matcher classification, transform, afterInsert — wired into `buildApp`

**Files:**
- Create: `packages/server/src/plugins/pipeline.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/plugin-pipeline.test.ts`

**Interfaces:**
- Consumes: `LoadedServerPlugin` (Task 6), `NormalizedEvent`, `StoredEvent`.
- Produces:
  - `classifyAndTransform(ev: NormalizedEvent, raw: Record<string, unknown>, plugins: LoadedServerPlugin[]): NormalizedEvent`
  - `runAfterInsert(stored: StoredEvent[], plugins: LoadedServerPlugin[]): void`
  - `buildApp` gains `plugins?: LoadedServerPlugin[]` in `AppOptions`; `POST /v1/log` classifies+transforms each event before insert and calls `runAfterInsert` after.

- [ ] **Step 1: Write the failing test**

`packages/server/test/plugin-pipeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'
import { buildApp } from '../src/app.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('ingest pipeline with plugins', () => {
  it('classifies via matchType and records afterInsert side effects', async () => {
    const db = openDb(':memory:')
    const plugins = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    const app = buildApp({ db, plugins })

    const res = await app.inject({
      method: 'POST', url: '/v1/log',
      payload: [{ msg: 'x', session_id: 's1', source: 'foo' }, { msg: 'y', session_id: 's1', source: 'web' }],
    })
    expect(res.statusCode).toBe(202)

    const events = await app.inject({ method: 'GET', url: '/api/sessions/s1/events' })
    const byMsg = Object.fromEntries((events.json().events as { msg: string; type: string }[]).map((e) => [e.msg, e.type]))
    expect(byMsg.x).toBe('foo')      // matched
    expect(byMsg.y).toBe('generic')  // unmatched → fallback

    const marks = db.prepare(`SELECT COUNT(*) c FROM plugin_foo_marks`).get() as { c: number }
    expect(marks.c).toBe(1) // afterInsert only received the 'foo'-typed event
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-pipeline.test.ts`
Expected: FAIL — `pipeline.js` missing and/or `buildApp` ignores `plugins`.

- [ ] **Step 3: Implement the pipeline**

`packages/server/src/plugins/pipeline.ts`:
```ts
import type { NormalizedEvent } from '../normalize.js'
import type { StoredEvent as CoreStoredEvent } from '../ingest.js'
import type { IncomingEvent, StoredEvent as SdkStoredEvent } from '@coglet/logsafe-plugin-sdk/server'
import type { LoadedServerPlugin } from './loader.js'

/** NormalizedEvent.ctx is a JSON string|null; IncomingEvent.ctx is parsed. */
function toIncoming(ev: NormalizedEvent, raw: Record<string, unknown>): IncomingEvent {
  return {
    session_id: ev.session_id, ts: ev.ts, received_at: ev.received_at,
    source: ev.source, ns: ev.ns, level: ev.level, msg: ev.msg,
    ctx: ev.ctx === null ? null : JSON.parse(ev.ctx),
    trace: ev.trace, type: ev.type, raw,
  }
}

function fromIncoming(base: NormalizedEvent, inc: IncomingEvent): NormalizedEvent {
  return {
    ...base,
    ns: inc.ns, level: inc.level, msg: inc.msg, trace: inc.trace, type: inc.type,
    ctx: inc.ctx === undefined || inc.ctx === null ? null : JSON.stringify(inc.ctx),
  }
}

function ownerFor(type: string, plugins: LoadedServerPlugin[]): LoadedServerPlugin | undefined {
  return plugins.find((p) => p.manifest.ownedTypes.includes(type))
}

/** Rule 2/3 of design §2.2: if still 'generic', run matchers in priority order;
 *  then let the owning plugin transform the event. */
export function classifyAndTransform(
  ev: NormalizedEvent, raw: Record<string, unknown>, plugins: LoadedServerPlugin[],
): NormalizedEvent {
  let type = ev.type
  if (type === 'generic') {
    for (const p of plugins) {
      const t = p.plugin.matchType?.(toIncoming({ ...ev, type: 'generic' }, raw))
      if (t) { type = t; break }
    }
  }
  let out: NormalizedEvent = type === ev.type ? ev : { ...ev, type }
  const owner = ownerFor(type, plugins)
  if (owner?.plugin.transform) {
    const patched = owner.plugin.transform(toIncoming(out, raw))
    if (patched) out = fromIncoming(out, patched)
  }
  return out
}

/** Group stored events by owning plugin and dispatch afterInsert. */
export function runAfterInsert(stored: CoreStoredEvent[], plugins: LoadedServerPlugin[]): void {
  for (const p of plugins) {
    if (!p.plugin.afterInsert) continue
    const mine = stored.filter((e) => p.manifest.ownedTypes.includes(e.type))
    if (mine.length > 0) p.plugin.afterInsert(mine as unknown as SdkStoredEvent[], p.ctx)
  }
}
```

- [ ] **Step 4: Wire it into `buildApp`**

In `packages/server/src/app.ts`:
- Add imports:
```ts
import type { LoadedServerPlugin } from './plugins/loader.js'
import { classifyAndTransform, runAfterInsert } from './plugins/pipeline.js'
```
- Add to `AppOptions`: `plugins?: LoadedServerPlugin[]`.
- Change the signature: `export function buildApp({ db, now = Date.now, plugins = [] }: AppOptions): FastifyInstance {`
- In `POST /v1/log`, for the **array** branch, after `const ev = normalizeEvent(raw, t)` classify before pushing:
```ts
      for (const raw of body) {
        const ev = normalizeEvent(raw, t)
        if (ev) good.push(classifyAndTransform(ev, raw as Record<string, unknown>, plugins))
      }
      const stored = insertBatch(db, good)
      runAfterInsert(stored, plugins)
      afterInsert(stored)
```
- In the **single-object** branch:
```ts
    const ev = normalizeEvent(body, t)
    if (!ev) { return reply.code(400).send({ error: 'event must be an object with a non-empty string msg' }) }
    const classified = classifyAndTransform(ev, body as Record<string, unknown>, plugins)
    const stored = insertBatch(db, [classified])
    runAfterInsert(stored, plugins)
    afterInsert(stored)
    return reply.code(202).send({ accepted: 1, rejected: 0 })
```
> `afterInsert` here is the existing SSE-publish closure — unchanged. `runAfterInsert` runs *before* it so derived data is written before live subscribers are notified.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/plugin-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (existing app/api tests still pass — `plugins` defaults to `[]`, so the no-plugin path is byte-for-byte the old behavior).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/plugins/pipeline.ts packages/server/src/app.ts packages/server/test/plugin-pipeline.test.ts
git commit -m "feat(server): plugin ingest pipeline — matchType, transform, afterInsert

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Mount plugin routes under `/api/plugins/<id>/`

**Files:**
- Modify: `packages/server/src/app.ts`
- Create: `packages/server/src/plugins/router.ts`
- Test: `packages/server/test/plugin-routes.test.ts`

**Interfaces:**
- Consumes: `LoadedServerPlugin`, `PluginRouter`, `PluginRouteHandler`, the Fastify instance.
- Produces: `mountPluginRoutes(app: FastifyInstance, plugins: LoadedServerPlugin[]): void` — registers each plugin's `routes()` under `/api/plugins/<id>`, JSON-serializing handler return values.

- [ ] **Step 1: Write the failing test**

`packages/server/test/plugin-routes.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'
import { buildApp } from '../src/app.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('plugin routes', () => {
  it('mounts a plugin GET under /api/plugins/<id>/', async () => {
    const db = openDb(':memory:')
    const plugins = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    const app = buildApp({ db, plugins })
    const res = await app.inject({ method: 'GET', url: '/api/plugins/foo/marks/s1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ session: 's1' })
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-routes.test.ts`
Expected: FAIL — route 404s (not mounted).

- [ ] **Step 3: Implement the router adapter**

`packages/server/src/plugins/router.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { LoadedServerPlugin } from './loader.js'
import type { PluginRouter, PluginRouteHandler } from '@coglet/logsafe-plugin-sdk/server'

/** Adapt a plugin's route registrations onto Fastify under a fixed prefix.
 *  Handler return values are sent as JSON (200); thrown errors become 500. */
export function mountPluginRoutes(app: FastifyInstance, plugins: LoadedServerPlugin[]): void {
  for (const p of plugins) {
    if (!p.plugin.routes) continue
    const prefix = `/api/plugins/${p.manifest.id}`
    const adapt = (handler: PluginRouteHandler) => async (req: {
      params: Record<string, string>; query: Record<string, string>; body: unknown
    }) => handler({ params: req.params ?? {}, query: (req.query ?? {}) as Record<string, string>, body: req.body })
    const router: PluginRouter = {
      get: (path, handler) => { app.get(`${prefix}${path}`, adapt(handler)) },
      post: (path, handler) => { app.post(`${prefix}${path}`, adapt(handler)) },
    }
    p.plugin.routes(router, p.ctx)
  }
}
```

- [ ] **Step 4: Call it from `buildApp`**

In `packages/server/src/app.ts`, add the import and call `mountPluginRoutes(app, plugins)` just before `return app`:
```ts
import { mountPluginRoutes } from './plugins/router.js'
// ... at the end of buildApp, before `return app`:
  mountPluginRoutes(app, plugins)
  return app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/server/test/plugin-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/plugins/router.ts packages/server/src/app.ts packages/server/test/plugin-routes.test.ts
git commit -m "feat(server): mount plugin routes under /api/plugins/<id>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `onSessionDelete` wired into delete + prune

**Files:**
- Modify: `packages/server/src/queries.ts`, `packages/server/src/retention.ts`, `packages/server/src/app.ts`, `packages/server/src/serve.ts`
- Test: `packages/server/test/plugin-cleanup.test.ts`

**Interfaces:**
- Produces:
  - `deleteSession(db, id, onDelete?: (sessionId: string) => void): boolean` — calls `onDelete(id)` inside the delete transaction when a session existed.
  - `pruneSessions(db, retentionDays, now, onDelete?: (sessionId: string) => void): number` — calls `onDelete(id)` for each pruned session inside the transaction.
  - `buildApp`'s `DELETE /api/sessions/:id` passes a callback that invokes every plugin's `onSessionDelete`.

- [ ] **Step 1: Write the failing test**

`packages/server/test/plugin-cleanup.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'
import { buildApp } from '../src/app.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('plugin session cleanup', () => {
  it('drops plugin rows when the session is deleted', async () => {
    const db = openDb(':memory:')
    const plugins = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    const app = buildApp({ db, plugins })
    await app.inject({ method: 'POST', url: '/v1/log', payload: [{ msg: 'x', session_id: 's1', source: 'foo' }] })
    expect((db.prepare(`SELECT COUNT(*) c FROM plugin_foo_marks`).get() as { c: number }).c).toBe(1)

    const res = await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })
    expect(res.statusCode).toBe(204)
    expect((db.prepare(`SELECT COUNT(*) c FROM plugin_foo_marks`).get() as { c: number }).c).toBe(0)
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-cleanup.test.ts`
Expected: FAIL — plugin rows survive (no cleanup hook).

- [ ] **Step 3: Add the `onDelete` callback to `deleteSession`**

In `packages/server/src/queries.ts`, change `deleteSession`:
```ts
export function deleteSession(db: Db, id: string, onDelete?: (sessionId: string) => void): boolean {
  const run = db.transaction((sid: string): boolean => {
    db.prepare('DELETE FROM events WHERE session_id = ?').run(sid)
    const res = db.prepare('DELETE FROM sessions WHERE id = ?').run(sid)
    if (res.changes > 0) onDelete?.(sid)
    return res.changes > 0
  })
  return run(id)
}
```

- [ ] **Step 4: Add the `onDelete` callback to `pruneSessions`**

In `packages/server/src/retention.ts`, change the signature and loop:
```ts
export function pruneSessions(
  db: Db, retentionDays: number, now: number, onDelete?: (sessionId: string) => void,
): number {
  if (retentionDays <= 0) return 0
  const cutoff = now - retentionDays * DAY_MS
  const ids = (db.prepare('SELECT id FROM sessions WHERE last_ts < ?').all(cutoff) as { id: string }[]).map((r) => r.id)
  if (ids.length === 0) return 0
  const run = db.transaction((sids: string[]) => {
    const delEvents = db.prepare('DELETE FROM events WHERE session_id = ?')
    const delSession = db.prepare('DELETE FROM sessions WHERE id = ?')
    for (const sid of sids) {
      delEvents.run(sid)
      delSession.run(sid)
      onDelete?.(sid)
    }
  })
  run(ids)
  return ids.length
}
```

- [ ] **Step 5: Build the callback in `buildApp` and pass it through**

In `packages/server/src/app.ts`, add a helper inside `buildApp` and use it in the DELETE route:
```ts
  const notifyPluginsDelete = (sessionId: string): void => {
    for (const p of plugins) p.plugin.onSessionDelete?.(sessionId, p.ctx)
  }
```
Change the DELETE handler line:
```ts
    if (!deleteSession(db, id, notifyPluginsDelete)) return reply.code(404).send({ error: 'session not found' })
```

- [ ] **Step 6: Thread the callback into the retention job in `serve.ts`**

In `packages/server/src/serve.ts` `safePrune()`, pass the same notifier (plugins will be available from Task 10; for now add the param and wire in Task 10). Leave `pruneSessions(db, RETENTION_DAYS, Date.now())` unchanged **in this task** — the prune-side notifier is connected in Task 10 once `serve.ts` owns the loaded plugins. The unit test above covers the delete path directly.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/plugin-cleanup.test.ts packages/server/test/retention.test.ts packages/server/test/queries.test.ts`
Expected: PASS (existing retention/queries tests still pass — `onDelete` is optional).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/queries.ts packages/server/src/retention.ts packages/server/src/app.ts packages/server/test/plugin-cleanup.test.ts
git commit -m "feat(server): call plugin.onSessionDelete on delete and prune

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: `serve.ts` loads config + passes plugins to `buildApp` and prune

**Files:**
- Create: `packages/server/src/plugins/config.ts`
- Modify: `packages/server/src/serve.ts`
- Test: `packages/server/test/plugin-config.test.ts`

**Interfaces:**
- Produces: `readPluginConfig(cwd: string, env: NodeJS.ProcessEnv): string[]` — reads `logsafe.config.json` (or `LOGSAFE_CONFIG` path), returns `plugins: string[]` (empty when absent/malformed, with a warning).

- [ ] **Step 1: Write the failing test**

`packages/server/test/plugin-config.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readPluginConfig } from '../src/plugins/config.js'

describe('plugin config', () => {
  it('returns [] when no config is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsafe-'))
    expect(readPluginConfig(dir, {})).toEqual([])
  })

  it('reads the plugins array from logsafe.config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsafe-'))
    fs.writeFileSync(path.join(dir, 'logsafe.config.json'), JSON.stringify({ plugins: ['a', './b'] }))
    expect(readPluginConfig(dir, {})).toEqual(['a', './b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-config.test.ts`
Expected: FAIL — `config.js` does not exist.

- [ ] **Step 3: Implement config reading**

`packages/server/src/plugins/config.ts`:
```ts
import fs from 'node:fs'
import path from 'node:path'

/** Reads the `plugins` string[] from logsafe.config.json (or $LOGSAFE_CONFIG).
    Absent or malformed → [] (with a warning), never throws. */
export function readPluginConfig(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const file = env.LOGSAFE_CONFIG ?? path.join(cwd, 'logsafe.config.json')
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { plugins?: unknown }
    if (!Array.isArray(parsed.plugins)) return []
    return parsed.plugins.filter((p): p is string => typeof p === 'string')
  } catch (err) {
    console.warn(`[logsafe] failed to read ${file}: ${(err as Error).message}`)
    return []
  }
}
```

- [ ] **Step 4: Wire loading into `serve.ts`**

In `packages/server/src/serve.ts`:
- Add imports:
```ts
import { readPluginConfig } from './plugins/config.js'
import { loadServerPlugins } from './plugins/loader.js'
```
- After `const db = openDb(DB_PATH)`, before `buildApp`:
```ts
  const specifiers = readPluginConfig(process.cwd(), process.env)
  const plugins = await loadServerPlugins(db, specifiers, process.cwd())
  if (plugins.length > 0) console.log(`[logsafe] loaded ${plugins.length} plugin(s): ${plugins.map((p) => p.manifest.id).join(', ')}`)
  const app = buildApp({ db, plugins })
```
- Change `safePrune()` to notify plugins:
```ts
  function safePrune(): void {
    try {
      const notify = (sid: string): void => { for (const p of plugins) p.plugin.onSessionDelete?.(sid, p.ctx) }
      const pruned = pruneSessions(db, RETENTION_DAYS, Date.now(), notify)
      if (pruned > 0) console.log(`[logsafe] retention: pruned ${pruned} session(s) older than ${RETENTION_DAYS}d`)
    } catch (err) {
      console.error('[logsafe] retention prune failed (will retry next interval):', (err as Error).message)
    }
  }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run packages/server/test/plugin-config.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual smoke (no plugins configured → unchanged behavior)**

Run: `npm start` in one shell; in another: `curl -s localhost:4600/v1/log -d '{"msg":"hi"}'`
Expected: `{"accepted":1,"rejected":0}`; server log shows no plugin line. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/plugins/config.ts packages/server/src/serve.ts packages/server/test/plugin-config.test.ts
git commit -m "feat(server): load plugins from logsafe.config.json at startup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Amend `API.md` (versioned, additive)

**Files:**
- Modify: `API.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Add a dated version note**

Under the FROZEN banner's bullet list at the top of `API.md`, add:
```markdown
> - 2026-07-14: plugin system (additive). `StoredEvent` gains `type: string`
>   (default `"generic"`); `SessionSummary` gains `types: string[]`; `POST
>   /v1/log` accepts an optional `type` field; the route namespace
>   `/api/plugins/<id>/*` is reserved for plugins. No existing field semantics
>   change.
```

- [ ] **Step 2: Document the `type` ingest field**

In the `POST /v1/log` "Event fields" table, add a row:
```markdown
| `type` | string | no | Non-empty string sets the event's type verbatim; otherwise a plugin matcher may claim it, else `"generic"`. Drives which plugin (if any) renders the session. |
```

- [ ] **Step 3: Document `type` on `StoredEvent` and `types` on `SessionSummary`**

In the `StoredEvent fields` table add:
```markdown
| `type` | string | Event type; `"generic"` unless set explicitly or by a plugin matcher. |
```
In the `SessionSummary` table (both the list and single-session sections reference it) add:
```markdown
| `types` | string[] | Distinct event types present in the session, sorted. `["generic"]` for an ordinary session. |
```

- [ ] **Step 4: Reserve the plugin route namespace**

In the "Notes on things that are intentionally out of scope here" section, add a bullet:
```markdown
- `GET|POST /api/plugins/<id>/*` is owned by installed plugins, not core. Shapes
  are defined by each plugin, not this contract.
```

- [ ] **Step 5: Commit**

```bash
git add API.md
git commit -m "docs(api): versioned note for additive plugin fields + route namespace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Group 2 checkpoint:** `npm run typecheck && npm test` — all green. The server now types events, loads plugins, runs ingest/route/cleanup hooks, and behaves identically when no plugin is configured.

---

# Group 3 — Client

### Task 12: `api.ts` — add `type`/`types`, `exportUrl`, and a `pluginFetch` factory

**Files:**
- Modify: `ui/src/api.ts`
- Test: `ui/src/test/api.test.ts`

**Interfaces:**
- Produces: `SessionSummary.types: string[]`; `StoredEvent.type: string`; `exportUrl(id, params): string`; `makePluginFetch(pluginId): PluginFetch`; a `coreApi: CoreApi` object bundling the existing fns for the runtime provider.

- [ ] **Step 1: Write the failing test**

Add to `ui/src/test/api.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { exportUrl, makePluginFetch } from '../api'

describe('api additions', () => {
  it('builds an export url with params', () => {
    expect(exportUrl('s 1', new URLSearchParams({ level: 'error' }))).toBe('/api/sessions/s%201/export.ndjson?level=error')
  })
  it('scopes pluginFetch to the plugin namespace', async () => {
    const calls: string[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: 1 }) } }) as never
    const pf = makePluginFetch('psdk')
    await pf('/views/s1')
    globalThis.fetch = orig
    expect(calls[0]).toBe('/api/plugins/psdk/views/s1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ui/src/test/api.test.ts -t "api additions"`
Expected: FAIL — `exportUrl`/`makePluginFetch` not exported.

- [ ] **Step 3: Implement the additions**

In `ui/src/api.ts`:
- Add `types: string[]` to `SessionSummary`; add `type: string` to `StoredEvent`.
- Append:
```ts
export function exportUrl(id: string, params: URLSearchParams): string {
  const qs = params.toString()
  return `/api/sessions/${encodeURIComponent(id)}/export.ndjson${qs ? `?${qs}` : ''}`
}

export type PluginFetch = <T = unknown>(path: string, init?: RequestInit) => Promise<T>

/** Scoped fetch to /api/plugins/<id>/… returning parsed JSON. */
export function makePluginFetch(pluginId: string): PluginFetch {
  return async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`/api/plugins/${pluginId}${path}`, init)
    await assertOk(res, `plugin ${pluginId} fetch ${path}`)
    return res.json() as Promise<T>
  }
}

/** The core query client, bundled for the plugin runtime context. */
export const coreApi = { fetchEventsPage, getSession, exportUrl }
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run ui/src/test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/api.ts ui/src/test/api.test.ts
git commit -m "feat(ui): api type/types fields, exportUrl, pluginFetch factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Extract `FlatLogView` from `SessionDetailPage`

**Files:**
- Create: `ui/src/components/FlatLogView.tsx`
- Modify: `ui/src/routes/SessionDetailPage.tsx`
- Test: existing `ui/src/test/*` (regression); add `ui/src/test/FlatLogView.test.tsx`

**Interfaces:**
- Produces: `FlatLogView` component with props `{ sessionId: string; session: SessionSummary | null; baseFilters?: { ns?: string; level?: string; source?: string; type?: string } }`. Renders the flat, filterable, virtualized log stream — everything currently below the crumb bar (CmdBar, PinnedStrip, stream + Minimap, StatusBar).

- [ ] **Step 1: Create `FlatLogView.tsx` by moving the flat-view body verbatim**

Create `ui/src/components/FlatLogView.tsx`. Move into it, **unchanged**, from `SessionDetailPage.tsx`: the `computeMinimapData` function, all constants (`ROW_H`, `OVERSCAN`, `TS_ORDER`, `MINIMAP_*`, etc.), the `isEditable`/`parseSeqList` helpers, and the entire hook body + JSX that renders `<CmdBar>`, `<PinnedStrip>`, `<div className="stream-wrap">…</div>`, and `<StatusBar>`. Wrap it as:
```tsx
export interface FlatLogViewProps {
  sessionId: string
  session: SessionSummary | null
  baseFilters?: { ns?: string; level?: string; source?: string; type?: string }
}

export function FlatLogView({ sessionId, session, baseFilters }: FlatLogViewProps) {
  const id = sessionId
  // …moved body: useUrlState, useEventStream, virtualizer, keyboard, minimap, JSX…
  // Return the fragment WITHOUT the <div className="crumbbar"> header.
}
```
Key adjustments while moving:
- The component receives `sessionId` and `session` as props instead of `useParams()` / its own `getSession` poll. **Remove** the `useParams` call and the `session`-loading `useEffect` (the parent owns them now).
- Fold `baseFilters` into the API params: where `apiParams = filtersToApiParams(filters)` is built, merge `baseFilters` first so a plugin can constrain the flat view (e.g. `{ type: 'generic' }`). Minimal approach:
```ts
  const apiParams = filtersToApiParams(filters)
  if (baseFilters?.type) apiParams.set('type', baseFilters.type)
  if (baseFilters?.ns) apiParams.set('ns', baseFilters.ns)
  if (baseFilters?.level) apiParams.set('level', baseFilters.level)
  if (baseFilters?.source) apiParams.set('source', baseFilters.source)
```
> `type` as an events filter requires a one-line addition to the server events query — see Step 2.

- [ ] **Step 2: Add `type` to the server events filter (so `baseFilters.type` works)**

In `packages/server/src/queries.ts` `EventFilters`, add `type?: string`; in `queryEvents`, after the `source` block, add:
```ts
  if (f.type) {
    const types = csv(f.type)
    if (types.length > 0) {
      where.push(`type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }
  }
```
And in `packages/server/src/app.ts` `parseFilters`, add `type: str(q.type),`.
Add a quick server test in `packages/server/test/queries.test.ts`:
```ts
it('filters events by type', () => {
  const db = openDb(':memory:')
  insertBatch(db, [normalizeEvent({ msg: 'a', session_id: 's', type: 'psdk' }, 1)!, normalizeEvent({ msg: 'b', session_id: 's' }, 1)!])
  expect(queryEvents(db, 's', { type: 'generic' }).events.map((e) => e.msg)).toEqual(['b'])
})
```

- [ ] **Step 3: Make `SessionDetailPage` render the crumb bar + `<FlatLogView>`**

Rewrite `SessionDetailPage.tsx` so it keeps ownership of `id` (from `useParams`) and the `session` summary poll, renders the `<div className="crumbbar">…</div>` header (moved back here — it needs `session`), and then renders `<FlatLogView sessionId={id} session={session} />`. (The full dispatcher that chooses a plugin `DetailView` lands in Task 16; for now it always renders `FlatLogView`.)

- [ ] **Step 4: Add a focused regression test**

`ui/src/test/FlatLogView.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FlatLogView } from '../components/FlatLogView'
import type { SessionSummary } from '../api'

afterEach(cleanup)

const session: SessionSummary = {
  id: 's1', label: 'x', first_ts: 0, last_ts: 1, duration_ms: 1, status: 'idle',
  event_count: 1, error_count: 0, warn_count: 0, sources: ['web'], types: ['generic'],
}

it('renders the flat stream for a session', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ events: [{ seq: 1, session_id: 's1', ts: 0, received_at: 0, source: 'web', ns: '', level: 'info', msg: 'hello-flat', ctx: null, trace: null, type: 'generic' }], next_after_seq: null }) }
    return { ok: true, status: 200, json: async () => session }
  }) as never)
  render(<MemoryRouter initialEntries={['/s/s1']}><FlatLogView sessionId="s1" session={session} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('hello-flat')).toBeTruthy())
})
```

- [ ] **Step 5: Run the UI suite + server suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — existing `SessionDetailPage` behavior is preserved (the tests that exercised the flat view still pass because the markup/logic moved intact), plus the new tests.
> If a pre-existing `SessionDetailPage.test.tsx` asserts on flat-view internals, update its import/target to `FlatLogView` where the assertion concerns the stream, keeping the assertions themselves unchanged.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/FlatLogView.tsx ui/src/routes/SessionDetailPage.tsx ui/src/test/FlatLogView.test.tsx packages/server/src/queries.ts packages/server/src/app.ts packages/server/test/queries.test.ts
git commit -m "refactor(ui): extract FlatLogView; add type events filter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Extract `DefaultSessionRow` from `SessionListPage`

**Files:**
- Create: `ui/src/components/DefaultSessionRow.tsx`
- Modify: `ui/src/routes/SessionListPage.tsx`
- Test: existing `ui/src/test/SessionListPage.test.tsx` (regression)

**Interfaces:**
- Produces: `DefaultSessionRow` component with props `{ session: SessionSummary; now: number; selected: boolean; onOpen(): void; onSelect(): void }` — renders exactly today's `.row` markup.

- [ ] **Step 1: Create the component by moving the row JSX verbatim**

Create `ui/src/components/DefaultSessionRow.tsx`. Move the per-session `<div className={`row…`}>…</div>` markup (the body of the `.map` in `SessionListPage`) into it, unchanged except the click handler now calls the props:
```tsx
import type { SessionSummary } from '../api'
import { formatDuration, formatStarted } from '../lib/time'
import { sourceColorIndex } from '../lib/sources'

export interface DefaultSessionRowProps {
  session: SessionSummary
  now: number
  selected: boolean
  onOpen(): void
  onSelect(): void
}

export function DefaultSessionRow({ session: s, now, selected, onOpen, onSelect }: DefaultSessionRowProps) {
  const { time, day } = formatStarted(s.first_ts, now)
  const isScratch = s.label === null
  const displayLabel = s.label ?? s.id
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      {/* …the exact spans currently in SessionListPage… */}
    </div>
  )
}
```

- [ ] **Step 2: Use it from `SessionListPage`**

In `SessionListPage.tsx`, replace the inline row markup in `.map` with:
```tsx
          sessions.map((s) => (
            <DefaultSessionRow
              key={s.id}
              session={s}
              now={now}
              selected={s.id === selectedId}
              onOpen={() => navigate(`/s/${s.id}`)}
              onSelect={() => setSelectedId(s.id)}
            />
          ))
```
Add the import.

- [ ] **Step 3: Run the UI suite + typecheck**

Run: `npm run typecheck && npx vitest run ui/src/test/SessionListPage.test.tsx`
Expected: PASS — same DOM output, existing assertions hold.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/DefaultSessionRow.tsx ui/src/routes/SessionListPage.tsx
git commit -m "refactor(ui): extract DefaultSessionRow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: UI plugin registry + `resolveViewOwner` + runtime context value

**Files:**
- Create: `ui/src/plugins/registry.ts`, `ui/src/plugins.generated.ts`, `ui/src/runtime.tsx`
- Modify: `ui/src/main.tsx`
- Test: `ui/src/test/registry.test.ts`, `ui/src/test/runtime.test.tsx`

**Interfaces:**
- Consumes: `UIPlugin`, `SessionSummary`, `LogsafeRuntime` (SDK/ui); `coreApi`, `makePluginFetch` (api); `FlatLogView` core impl; `useEventStream`.
- Produces:
  - `plugins.generated.ts`: `export const uiPlugins: UIPlugin[] = []` (codegen overwrites this in Task 17; hand-written empty default keeps the app building now).
  - `registry.ts`: `buildRegistry(plugins: UIPlugin[]): Map<string, UIPlugin>` and `resolveViewOwner(session: SessionSummary, registry: Map<string, UIPlugin>): UIPlugin | undefined` (highest-priority-by-registry-order match on `session.types`).
  - `runtime.tsx`: `logsafeRuntime: LogsafeRuntime` value + a `useSessionEventsImpl` bridging `useEventStream`.

- [ ] **Step 1: Write the failing registry test**

`ui/src/test/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import type { UIPlugin, SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

function s(types: string[]): SessionSummary {
  return { id: 's', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 0, error_count: 0, warn_count: 0, sources: [], types }
}

describe('resolveViewOwner', () => {
  const psdk: UIPlugin = { type: 'psdk' }
  const reg = buildRegistry([psdk])
  it('picks the plugin whose type appears in the session', () => {
    expect(resolveViewOwner(s(['generic', 'psdk']), reg)).toBe(psdk)
  })
  it('returns undefined when no installed plugin matches', () => {
    expect(resolveViewOwner(s(['generic']), reg)).toBeUndefined()
    expect(resolveViewOwner(s(['unknown']), reg)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ui/src/test/registry.test.ts`
Expected: FAIL — `../plugins/registry` missing.

- [ ] **Step 3: Implement the registry + the generated stub**

`ui/src/plugins.generated.ts`:
```ts
// AUTO-GENERATED by scripts/plugins-sync.mjs — do not edit by hand.
import type { UIPlugin } from '@coglet/logsafe-plugin-sdk/ui'
export const uiPlugins: UIPlugin[] = []
```
`ui/src/plugins/registry.ts`:
```ts
import type { UIPlugin, SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

/** Registry preserves insertion order; the generated array is already ordered
 *  by manifest priority (see scripts/plugins-sync.mjs), so first match wins. */
export function buildRegistry(plugins: UIPlugin[]): Map<string, UIPlugin> {
  const map = new Map<string, UIPlugin>()
  for (const p of plugins) if (!map.has(p.type)) map.set(p.type, p)
  return map
}

/** Highest-priority installed plugin whose type ∈ session.types; else undefined. */
export function resolveViewOwner(session: SessionSummary, registry: Map<string, UIPlugin>): UIPlugin | undefined {
  for (const [type, plugin] of registry) {
    if (session.types.includes(type)) return plugin
  }
  return undefined
}
```

- [ ] **Step 4: Write the failing runtime test**

`ui/src/test/runtime.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { logsafeRuntime } from '../runtime'

describe('logsafeRuntime', () => {
  it('exposes the core api and a scoped pluginFetch factory', () => {
    expect(typeof logsafeRuntime.api.getSession).toBe('function')
    expect(typeof logsafeRuntime.makePluginFetch('psdk')).toBe('function')
    expect(typeof logsafeRuntime.FlatLogView).toBe('function')
    expect(logsafeRuntime.tokens.phos).toBe('var(--phos)')
  })
})
```

- [ ] **Step 5: Implement `runtime.tsx`**

`ui/src/runtime.tsx`:
```tsx
import type { LogsafeRuntime, ThemeTokens, SessionEventsState } from '@coglet/logsafe-plugin-sdk/ui'
import { coreApi, makePluginFetch } from './api'
import { FlatLogView } from './components/FlatLogView'
import { useEventStream } from './hooks/useEventStream'

const tokens: ThemeTokens = {
  bg: 'var(--bg)', bgRaise: 'var(--bg-raise)', txt: 'var(--txt)', dim: 'var(--dim)',
  faint: 'var(--faint)', line: 'var(--line)', phos: 'var(--phos)', amber: 'var(--amber)',
  err: 'var(--err)', rowH: 'var(--row-h)',
  sources: ['var(--cyan)', 'var(--violet)', 'var(--slate)', 'var(--gold)', 'var(--green)', 'var(--rose)'],
}

/** Bridge the core event-stream hook to the SDK's simpler facade shape. */
function useSessionEventsImpl(sessionId: string, filters?: URLSearchParams): SessionEventsState {
  const [state, api] = useEventStream(sessionId, filters ?? new URLSearchParams(), [])
  return { events: state.events, loading: state.loading, tail: state.tail, pause: api.pause, resume: api.resume, error: state.error }
}

export const logsafeRuntime: LogsafeRuntime = {
  api: coreApi,
  makePluginFetch,
  FlatLogView,
  useSessionEvents: useSessionEventsImpl,
  tokens,
}
```
> `useEventStream`'s public state (`events/loading/tail/error`) and api (`pause/resume`) already match `SessionEventsState`. The core `StoredEvent` gained `type` in Task 12, so it is structurally the SDK `StoredEvent`.

- [ ] **Step 6: Wrap the app root with the provider**

In `ui/src/main.tsx`, import and wrap:
```tsx
import { LogsafeRuntimeProvider } from '@coglet/logsafe-plugin-sdk/ui'
import { logsafeRuntime } from './runtime'
// …
  <StrictMode>
    <LogsafeRuntimeProvider value={logsafeRuntime}>
      <BrowserRouter>
        <Shell>{/* Routes unchanged */}</Shell>
      </BrowserRouter>
    </LogsafeRuntimeProvider>
  </StrictMode>
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run ui/src/test/registry.test.ts ui/src/test/runtime.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/src/plugins ui/src/plugins.generated.ts ui/src/runtime.tsx ui/src/main.tsx ui/src/test/registry.test.ts ui/src/test/runtime.test.tsx
git commit -m "feat(ui): plugin registry, resolveViewOwner, runtime context provider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: List + detail dispatch to plugins (with not-installed banner)

**Files:**
- Modify: `ui/src/routes/SessionListPage.tsx`, `ui/src/routes/SessionDetailPage.tsx`
- Test: `ui/src/test/pluginDispatch.test.tsx`

**Interfaces:**
- Consumes: `resolveViewOwner`, `buildRegistry`, `uiPlugins`, `coreApi`, `makePluginFetch`, `useUrlState`.
- Produces: list rows use a plugin `ListRow` when one owns the session, else `DefaultSessionRow`; detail renders a plugin `DetailView` when one owns the session, else `FlatLogView`; a typed-but-unowned session shows a note banner above the flat view.

- [ ] **Step 1: Write the failing test**

`ui/src/test/pluginDispatch.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { UIPlugin } from '@coglet/logsafe-plugin-sdk/ui'

// Mock the generated registry BEFORE importing the pages.
vi.mock('../plugins.generated', () => {
  const hello: UIPlugin = {
    type: 'hello',
    ListRow: ({ session }) => <div>ROW:{session.id}</div>,
    DetailView: ({ sessionId }) => <div>DETAIL:{sessionId}</div>,
  }
  return { uiPlugins: [hello] }
})

import { SessionListPage } from '../routes/SessionListPage'
import { SessionDetailPage } from '../routes/SessionDetailPage'

afterEach(cleanup)
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/api/sessions')) return { ok: true, status: 200, json: async () => [{ id: 's1', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 0, error_count: 0, warn_count: 0, sources: [], types: ['hello'] }] }
    if (url.match(/\/api\/sessions\/s1$/)) return { ok: true, status: 200, json: async () => ({ id: 's1', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 0, error_count: 0, warn_count: 0, sources: [], types: ['hello'] }) }
    return { ok: true, status: 200, json: async () => ({ events: [], next_after_seq: null }) }
  }) as never)
})

it('list uses the plugin ListRow for an owned session', async () => {
  render(<MemoryRouter><SessionListPage /></MemoryRouter>)
  expect(await screen.findByText('ROW:s1')).toBeTruthy()
})

it('detail renders the plugin DetailView for an owned session', async () => {
  render(<MemoryRouter initialEntries={['/s/s1']}><Routes><Route path="/s/:id" element={<SessionDetailPage />} /></Routes></MemoryRouter>)
  expect(await screen.findByText('DETAIL:s1')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ui/src/test/pluginDispatch.test.tsx`
Expected: FAIL — pages don't consult the registry yet.

- [ ] **Step 3: Dispatch in `SessionListPage`**

At module scope (once), build the registry:
```ts
import { uiPlugins } from '../plugins.generated'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import { coreApi, makePluginFetch } from '../api'
const registry = buildRegistry(uiPlugins)
```
In the `.map`, choose the renderer:
```tsx
          sessions.map((s) => {
            const owner = resolveViewOwner(s, registry)
            if (owner?.ListRow) {
              const Row = owner.ListRow
              return (
                <Row key={s.id} session={s} now={now} selected={s.id === selectedId}
                  onOpen={() => navigate(`/s/${s.id}`)} onSelect={() => setSelectedId(s.id)}
                  api={coreApi} pluginFetch={makePluginFetch(owner.type)} />
              )
            }
            return (
              <DefaultSessionRow key={s.id} session={s} now={now} selected={s.id === selectedId}
                onOpen={() => navigate(`/s/${s.id}`)} onSelect={() => setSelectedId(s.id)} />
            )
          })
```

- [ ] **Step 4: Dispatch in `SessionDetailPage`**

Build the registry at module scope (same imports). Task 13 moved `useUrlState` into `FlatLogView`, so re-add it to `SessionDetailPage` for the plugin `DetailView`'s `urlState` prop:
```tsx
import { useUrlState } from '../hooks/useUrlState'
import { logsafeRuntime } from '../runtime'
import { coreApi, makePluginFetch } from '../api'
import { uiPlugins } from '../plugins.generated'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
const registry = buildRegistry(uiPlugins)
// inside the component, alongside the existing hooks:
const { params, setParams } = useUrlState()
```
After `session` is loaded, resolve and branch:
```tsx
  const owner = session ? resolveViewOwner(session, registry) : undefined

  // typed-but-unowned: session has a non-generic type no installed plugin claims
  const unownedType = session?.types.find((t) => t !== 'generic' && !registry.has(t))

  if (owner?.DetailView) {
    const Detail = owner.DetailView
    return (
      <>
        {/* keep the crumbbar header */}
        <Detail session={session} sessionId={id} api={coreApi}
          pluginFetch={makePluginFetch(owner.type)} urlState={{ params, setParams }} tokens={logsafeRuntime.tokens} />
      </>
    )
  }
  return (
    <>
      {/* crumbbar header */}
      {unownedType && (
        <div className="empty-state" style={{ color: 'var(--amber)' }}>
          This session has <b>{unownedType}</b> data. Install the {unownedType} plugin to see its view — showing raw logs.
        </div>
      )}
      <FlatLogView sessionId={id} session={session} />
    </>
  )
```
(`tokens` comes from `logsafeRuntime`, imported above; `params/setParams` from the re-added `useUrlState()`.)

- [ ] **Step 5: Run tests + typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS (dispatch tests + all regressions; with the empty real `uiPlugins`, production behavior is still flat-everywhere).

- [ ] **Step 6: Commit**

```bash
git add ui/src/routes/SessionListPage.tsx ui/src/routes/SessionDetailPage.tsx ui/src/test/pluginDispatch.test.tsx
git commit -m "feat(ui): dispatch list row + detail view to plugins; not-installed banner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 17: Codegen `plugins:sync` + build wiring

**Files:**
- Create: `scripts/plugins-sync.mjs`
- Modify: root `package.json` (scripts)
- Test: `packages/server/test/plugins-sync.test.ts`

**Interfaces:**
- Produces: `scripts/plugins-sync.mjs` reads `logsafe.config.json` `plugins[]`, resolves each package's `logsafe` manifest, orders by `priority` desc, and writes `ui/src/plugins.generated.ts` importing each `ui` entry (skipping plugins with no `ui`). `npm run build:ui` runs it first.

- [ ] **Step 1: Write the failing test**

`packages/server/test/plugins-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('plugins-sync codegen', () => {
  it('emits an empty registry when config lists no plugins', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsync-'))
    fs.writeFileSync(path.join(dir, 'logsafe.config.json'), JSON.stringify({ plugins: [] }))
    const out = path.join(dir, 'plugins.generated.ts')
    execFileSync('node', [path.join(import.meta.dirname, '..', '..', '..', 'scripts', 'plugins-sync.mjs')], {
      env: { ...process.env, LOGSAFE_CONFIG: path.join(dir, 'logsafe.config.json'), LOGSAFE_UI_OUT: out },
    })
    const text = fs.readFileSync(out, 'utf8')
    expect(text).toContain('export const uiPlugins')
    expect(text).toContain('[]')
  })
})
```
> The script honors `LOGSAFE_CONFIG` (which config) and `LOGSAFE_UI_OUT` (where to write) so it is testable in a temp dir. In normal use both default to repo-relative paths.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugins-sync.test.ts`
Expected: FAIL — `scripts/plugins-sync.mjs` does not exist.

- [ ] **Step 3: Implement the codegen script**

`scripts/plugins-sync.mjs`:
```js
#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = process.env.LOGSAFE_CONFIG ?? path.join(root, 'logsafe.config.json')
const outPath = process.env.LOGSAFE_UI_OUT ?? path.join(root, 'ui', 'src', 'plugins.generated.ts')

function readConfig() {
  if (!fs.existsSync(configPath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return Array.isArray(parsed.plugins) ? parsed.plugins.filter((p) => typeof p === 'string') : []
  } catch { return [] }
}

const require = createRequire(path.join(root, 'noop.js'))
const entries = []
for (const spec of readConfig()) {
  let pkg
  try { pkg = require(`${spec}/package.json`) } catch { console.warn(`[plugins-sync] cannot resolve ${spec}; skipping`); continue }
  const m = pkg.logsafe
  if (!m?.id || !m.ui) continue // ui-only relevance: no ui entry → nothing to import
  entries.push({ id: m.id, priority: m.priority ?? 0, spec })
}
entries.sort((a, b) => b.priority - a.priority)

const imports = entries.map((e, i) => `import p${i} from '${e.spec}/ui'`).join('\n')
const list = entries.map((_, i) => `p${i}`).join(', ')
const body = `// AUTO-GENERATED by scripts/plugins-sync.mjs — do not edit by hand.
import type { UIPlugin } from '@coglet/logsafe-plugin-sdk/ui'
${imports}
export const uiPlugins: UIPlugin[] = [${list}]
`
fs.writeFileSync(outPath, body)
console.log(`[plugins-sync] wrote ${entries.length} plugin(s) to ${path.relative(root, outPath)}`)
```
> Assumes each plugin package exposes a `./ui` subpath export (the SDK-recommended layout; see the hello plugin in Task 18).

- [ ] **Step 4: Wire it into the build**

In root `package.json` `scripts`, add and chain:
```json
    "plugins:sync": "node scripts/plugins-sync.mjs",
    "build:ui": "npm run plugins:sync && npm run build --workspace=ui",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/server/test/plugins-sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate the checked-in stub (should stay empty — no plugins configured)**

Run: `npm run plugins:sync`
Expected: `ui/src/plugins.generated.ts` unchanged (empty `uiPlugins`) since there is no root `logsafe.config.json`. `git status` shows no diff for that file.

- [ ] **Step 7: Commit**

```bash
git add scripts/plugins-sync.mjs package.json packages/server/test/plugins-sync.test.ts
git commit -m "feat(build): plugins:sync codegen for the UI registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 18: Acceptance — the "hello" plugin end to end

**Files:**
- Create: `examples/plugin-hello/package.json`, `examples/plugin-hello/server.ts`, `examples/plugin-hello/ui.tsx`
- Test: `ui/src/test/helloPlugin.test.tsx`

**Interfaces:**
- Consumes: the entire SDK + registry contract. Proves a real plugin object satisfies `UIPlugin`/`ServerPlugin` and is resolved by `resolveViewOwner`.

- [ ] **Step 1: Write the plugin (mirrors design §9)**

`examples/plugin-hello/package.json`:
```json
{
  "name": "logsafe-plugin-hello",
  "version": "0.0.1",
  "type": "module",
  "exports": { "./server": "./server.ts", "./ui": "./ui.tsx" },
  "peerDependencies": { "@coglet/logsafe-plugin-sdk": "*", "react": "^19" },
  "logsafe": {
    "id": "hello", "apiVersion": "1", "ownedTypes": ["hello"], "priority": 10,
    "server": "./server.ts", "ui": "./ui.tsx"
  }
}
```
`examples/plugin-hello/server.ts`:
```ts
import type { ServerPlugin } from '@coglet/logsafe-plugin-sdk/server'
const plugin: ServerPlugin = {
  matchType: (e) => (e.ns.startsWith('hello:') ? 'hello' : null),
}
export default plugin
```
`examples/plugin-hello/ui.tsx`:
```tsx
import type { UIPlugin, ListRowProps, DetailViewProps } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'

function HelloRow({ session, selected, onOpen, onSelect }: ListRowProps) {
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className="status active">●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span className="src src-0" style={{ color: 'var(--phos)' }}>👋 hello · {session.event_count} evts</span>
    </div>
  )
}
function HelloDetail({ session, sessionId }: DetailViewProps) {
  return (
    <>
      <div style={{ padding: '8px 20px', color: 'var(--phos)' }}>
        👋 Hello plugin — custom view for {session?.label ?? sessionId}
      </div>
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}
const plugin: UIPlugin = { type: 'hello', ListRow: HelloRow, DetailView: HelloDetail }
export default plugin
```

- [ ] **Step 2: Write the acceptance test**

`ui/src/test/helloPlugin.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import helloUi from '../../../examples/plugin-hello/ui'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import type { SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

const session = (types: string[]): SessionSummary => ({ id: 's', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 3, error_count: 0, warn_count: 0, sources: [], types })

describe('hello plugin against the real contract', () => {
  it('is a valid UIPlugin resolved for a hello-typed session', () => {
    expect(helloUi.type).toBe('hello')
    const reg = buildRegistry([helloUi])
    expect(resolveViewOwner(session(['generic', 'hello']), reg)).toBe(helloUi)
    expect(resolveViewOwner(session(['generic']), reg)).toBeUndefined()
  })
})
```
> Importing `examples/plugin-hello/ui` compiles the plugin against the SDK types — a real type-level acceptance of the contract. Ensure `ui/tsconfig.json` `include` covers `../examples` or add the path; if the import path is rejected by Vitest's root config, the file resolves fine because Vitest uses Vite resolution from repo root.

- [ ] **Step 3: Run the test + typecheck**

Run: `npm run typecheck && npx vitest run ui/src/test/helloPlugin.test.tsx`
Expected: PASS.

- [ ] **Step 4: Full manual smoke (optional but recommended)**

- Create `logsafe.config.json` at repo root: `{ "plugins": ["./examples/plugin-hello"] }`.
- Run `npm run plugins:sync` → `ui/src/plugins.generated.ts` now imports the hello ui.
- Run `npm run build:ui` then `npm start`.
- `curl -s localhost:4600/v1/log -d '{"msg":"hi","ns":"hello:greet","session_id":"h1"}'`
- Open `http://localhost:4600` → `h1` shows the 👋 badge; opening it shows the banner over the flat log.
- Revert: delete `logsafe.config.json`, re-run `npm run plugins:sync` to restore the empty registry, `git status` clean for `plugins.generated.ts`.

- [ ] **Step 5: Commit**

```bash
git add examples/plugin-hello ui/src/test/helloPlugin.test.tsx
git commit -m "test: hello plugin acceptance against the SDK contract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `npm run typecheck && npm test` — all green.
- [ ] Confirm `ui/src/plugins.generated.ts` is the empty stub (no plugin configured in-repo) so default behavior is unchanged.
- [ ] Confirm no plugin configured ⇒ server + UI behave exactly as before this work.

---

## Notes / deferred (out of scope, from design §13)

- **npm-publish builds** for `@coglet/logsafe-plugin-sdk` and third-party plugins (compiled `dist` + subpath exports pointing at JS) — in-repo dev/test consume `.ts`/`.tsx` directly.
- **Runtime UI drop-in** (dynamic `import()` of prebuilt plugin bundles) — the plugin code is unchanged if added later; only discovery changes.
- **Shared time axis** between a plugin timeline and the composed `FlatLogView`.
- **Async/queued `afterInsert`** if a plugin's per-batch metric work becomes heavy (contract signature stays the same).
