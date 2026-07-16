# HTTP Example Plugin + Author Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `examples/plugin-http` (a full-contract example plugin whose detail view renders an SVG request timeline), `templates/plugin-starter` (a copyable starter package), and `docs/PLUGINS.md` (the authoring guide).

**Architecture:** Four tasks on the existing PR #2 branch. Task 1 builds the plugin's server side (matcher/transform/table/routes/cleanup) tested through the real app pipeline. Task 2 builds the UI (badge row + timeline detail view composing FlatLogView) with a pure geometry helper so the timeline math is unit-testable. Task 3 is the starter template + a type-conformance test. Task 4 is documentation.

**Tech Stack:** TypeScript (NodeNext, strict), React 19, `@coglet/logsafe-plugin-sdk`, plain SVG (NO chart library), Vitest 4 + `@testing-library/react` + jsdom.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-15-plugin-http-example-and-templates-design.md` — values below are copied from it; follow verbatim.
- **Branch:** work directly on `claude/debug-log-plugin-system-3a31ee` (delivered onto PR #2).
- Tests: `npm test` from repo root; single file via `npx vitest run <path>`; React tests MUST start with `// @vitest-environment jsdom`. Typecheck: `npm run typecheck` must stay green.
- Plugin id `http`, `apiVersion: "1"`, `ownedTypes: ["http"]`, `priority: 5`. Table name `plugin_http_requests` (always via `ctx.db.table('requests')`).
- Timeline visual: plain SVG, colors ONLY from the SDK `tokens` prop (`tokens.phos` for 2xx/3xx, `tokens.amber` for slow/4xx, `tokens.err` for 5xx); rows capped at **40** (newest wins); bar min-width **2px**; click a bar → set `trace` in the URL via the `urlState` prop.
- `transform` marks `ctx.slow = true` when `ctx.latency_ms > 1000`.
- Summary/requests refresh: poll every **5000ms** (`SUMMARY_POLL_MS`), no SSE in the example.
- `logsafe.config.json` and `ui/src/plugins.generated.ts` must NOT be committed with the http plugin enabled — the committed registry stays the empty stub.
- Commit after every task, message trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- Create: `examples/plugin-http/package.json`, `examples/plugin-http/server.ts`, `examples/plugin-http/ui.tsx`, `examples/plugin-http/timeline.ts` (pure geometry helper)
- Create: `templates/plugin-starter/package.json`, `templates/plugin-starter/server.ts`, `templates/plugin-starter/ui.tsx`, `templates/plugin-starter/README.md`
- Create: `docs/PLUGINS.md`
- Modify: `README.md` (link the guide)
- Test: `packages/server/test/plugin-http.test.ts`, `ui/src/test/httpPlugin.test.tsx`, `ui/src/test/timeline.test.ts`, `ui/src/test/starterTemplate.test.tsx`

---

### Task 1: `plugin-http` server side

**Files:**
- Create: `examples/plugin-http/package.json`
- Create: `examples/plugin-http/server.ts`
- Test: `packages/server/test/plugin-http.test.ts`

**Interfaces:**
- Consumes: `ServerPlugin`, `IncomingEvent`, `StoredEvent` (`@coglet/logsafe-plugin-sdk/server`); `makePluginContext` (`packages/server/src/plugins/context.ts`); `buildApp` (`packages/server/src/app.ts`); `openDb`.
- Produces: default-exported `ServerPlugin` for type `http`; table `plugin_http_requests(session_id, trace, method, path, status, latency_ms, ts, PRIMARY KEY(session_id, trace))`; routes `GET /api/plugins/http/summary/:sessionId` → `{ request_count, error_count, avg_latency_ms, max_latency_ms }` and `GET /api/plugins/http/requests/:sessionId` → `{ requests: HttpRequestRow[] }` (ts ASC). `HttpRequestRow = { session_id: string; trace: string; method: string | null; path: string | null; status: number | null; latency_ms: number | null; ts: number }`.

- [ ] **Step 1: Create the manifest**

`examples/plugin-http/package.json`:
```json
{
  "name": "logsafe-plugin-http",
  "version": "0.1.0",
  "type": "module",
  "exports": { "./server": "./server.ts", "./ui": "./ui.tsx" },
  "peerDependencies": { "@coglet/logsafe-plugin-sdk": "*", "react": "^19" },
  "logsafe": {
    "id": "http", "version": "0.1.0", "apiVersion": "1",
    "ownedTypes": ["http"], "priority": 5,
    "server": "./server.ts", "ui": "./ui.tsx"
  }
}
```

- [ ] **Step 2: Write the failing test**

`packages/server/test/plugin-http.test.ts` — import the plugin **statically** (avoids dynamic-import-of-TS pitfalls under Vitest; hand-build the `LoadedServerPlugin` exactly like `plugin-cleanup.test.ts` does for its inline plugin):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { makePluginContext } from '../src/plugins/context.js'
import type { LoadedServerPlugin } from '../src/plugins/loader.js'
import httpPlugin from '../../../examples/plugin-http/server'

const MANIFEST = { id: 'http', version: '0.1.0', apiVersion: '1', ownedTypes: ['http'], priority: 5 }

function loaded(db: Db): LoadedServerPlugin {
  const ctx = makePluginContext(db, 'http')
  httpPlugin.migrate?.(ctx)
  return { manifest: MANIFEST, plugin: httpPlugin, ctx }
}

const BATCH = [
  { msg: 'GET /',      session_id: 's1', source: 'web', ns: 'http',      trace: 't1', ts: 1000, ctx: { method: 'GET',  path: '/',    status: 200, latency_ms: 120 } },
  { msg: 'POST /vote', session_id: 's1', source: 'web', ns: 'http:vote', trace: 't2', ts: 2000, ctx: { method: 'POST', path: '/vote', status: 200, latency_ms: 1500 } },
  { msg: 'POST /vote', session_id: 's1', source: 'web', ns: 'http:vote', trace: 't3', ts: 3000, ctx: { method: 'POST', path: '/vote', status: 500, latency_ms: 88 } },
  { msg: 'app log',    session_id: 's1', source: 'web', ns: 'app',       ts: 3500 },              // generic — not claimed
  { msg: 'no ctx',     session_id: 's1', source: 'web', ns: 'http:misc', trace: 't4', ts: 4000 }, // claimed, no request fields
]

describe('plugin-http server', () => {
  let db: Db
  let app: ReturnType<typeof buildApp>
  beforeEach(async () => {
    db = openDb(':memory:')
    app = buildApp({ db, plugins: [loaded(db)] })
    await app.inject({ method: 'POST', url: '/v1/log', payload: BATCH })
  })

  it('claims http:* events and transforms slow ones', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/s1/events' })
    const events = res.json().events as { ns: string; type: string; ctx: Record<string, unknown> | null }[]
    const byNs = Object.fromEntries(events.map((e) => [e.ns, e]))
    expect(byNs['http'].type).toBe('http')
    expect(byNs['app'].type).toBe('generic')
    expect(byNs['http:vote'].type).toBe('http')
    const slow = events.find((e) => (e.ctx as { latency_ms?: number } | null)?.latency_ms === 1500)!
    expect((slow.ctx as { slow?: boolean }).slow).toBe(true)
    const fast = events.find((e) => (e.ctx as { latency_ms?: number } | null)?.latency_ms === 120)!
    expect((fast.ctx as { slow?: boolean }).slow).toBeUndefined()
  })

  it('upserts request rows (only events with request ctx) and serves /requests ordered', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/http/requests/s1' })
    const { requests } = res.json() as { requests: { trace: string; ts: number; status: number | null }[] }
    expect(requests.map((r) => r.trace)).toEqual(['t1', 't2', 't3']) // ts ASC; t4 had no request fields
  })

  it('re-ingesting the same trace updates, not duplicates', async () => {
    await app.inject({ method: 'POST', url: '/v1/log', payload: [
      { msg: 'GET / retry', session_id: 's1', source: 'web', ns: 'http', trace: 't1', ts: 1000, ctx: { method: 'GET', path: '/', status: 503, latency_ms: 300 } },
    ] })
    const res = await app.inject({ method: 'GET', url: '/api/plugins/http/requests/s1' })
    const { requests } = res.json() as { requests: { trace: string; status: number }[] }
    expect(requests.filter((r) => r.trace === 't1')).toHaveLength(1)
    expect(requests.find((r) => r.trace === 't1')!.status).toBe(503)
  })

  it('serves aggregate /summary (error = status >= 500)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/http/summary/s1' })
    expect(res.json()).toEqual({
      request_count: 3,
      error_count: 1,
      avg_latency_ms: Math.round((120 + 1500 + 88) / 3),
      max_latency_ms: 1500,
    })
  })

  it('cleans its rows on session delete', async () => {
    await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })
    const c = db.prepare('SELECT COUNT(*) c FROM plugin_http_requests').get() as { c: number }
    expect(c.c).toBe(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-http.test.ts`
Expected: FAIL — cannot resolve `../../../examples/plugin-http/server`.

- [ ] **Step 4: Implement the server plugin**

`examples/plugin-http/server.ts`:
```ts
// logsafe-plugin-http — server side. Claims http/http:* events, derives a
// per-request table (one row per trace), and serves summary + request-list
// routes for the UI's badge and timeline. Exercises every ServerPlugin hook.
import type { ServerPlugin, IncomingEvent, StoredEvent, ServerPluginContext } from '@coglet/logsafe-plugin-sdk/server'

export interface HttpRequestRow {
  session_id: string
  trace: string
  method: string | null
  path: string | null
  status: number | null
  latency_ms: number | null
  ts: number
}

const SLOW_MS = 1000

function requestCtx(ev: IncomingEvent | StoredEvent): Record<string, unknown> | null {
  const c = ev.ctx
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return null
  const r = c as Record<string, unknown>
  // A "request" event carries at least one of the request fields.
  if (r.method === undefined && r.path === undefined && r.status === undefined && r.latency_ms === undefined) return null
  return r
}

const plugin: ServerPlugin = {
  matchType: (e) => (e.ns === 'http' || e.ns.startsWith('http:') ? 'http' : null),

  transform: (e) => {
    const r = requestCtx(e)
    if (!r || typeof r.latency_ms !== 'number' || r.latency_ms <= SLOW_MS) return
    return { ...e, ctx: { ...r, slow: true } }
  },

  migrate: (ctx) => {
    ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('requests')} (
      session_id TEXT NOT NULL,
      trace      TEXT NOT NULL,
      method     TEXT,
      path       TEXT,
      status     INTEGER,
      latency_ms INTEGER,
      ts         INTEGER NOT NULL,
      PRIMARY KEY (session_id, trace)
    )`)
  },

  afterInsert: (events, ctx) => {
    const upsert = ctx.db.prepare(`
      INSERT INTO ${ctx.db.table('requests')} (session_id, trace, method, path, status, latency_ms, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, trace) DO UPDATE SET
        method = excluded.method, path = excluded.path, status = excluded.status,
        latency_ms = excluded.latency_ms, ts = excluded.ts
    `)
    for (const e of events) {
      const r = requestCtx(e)
      if (!r) continue // claimed but not a request event — flat log only
      upsert.run(
        e.session_id,
        e.trace ?? String(e.seq),
        typeof r.method === 'string' ? r.method : null,
        typeof r.path === 'string' ? r.path : null,
        typeof r.status === 'number' ? r.status : null,
        typeof r.latency_ms === 'number' ? r.latency_ms : null,
        e.ts,
      )
    }
  },

  routes: (router, ctx) => {
    router.get('/summary/:sessionId', (req) => {
      const agg = ctx.db.prepare(`
        SELECT count(*) AS request_count,
               coalesce(sum(status >= 500), 0) AS error_count,
               coalesce(avg(latency_ms), 0) AS avg_latency,
               coalesce(max(latency_ms), 0) AS max_latency_ms
        FROM ${ctx.db.table('requests')} WHERE session_id = ?
      `).get(req.params.sessionId) as { request_count: number; error_count: number; avg_latency: number; max_latency_ms: number }
      return {
        request_count: agg.request_count,
        error_count: agg.error_count,
        avg_latency_ms: Math.round(agg.avg_latency),
        max_latency_ms: agg.max_latency_ms,
      }
    })
    router.get('/requests/:sessionId', (req) => ({
      requests: ctx.db.prepare(
        `SELECT * FROM ${ctx.db.table('requests')} WHERE session_id = ? ORDER BY ts ASC`,
      ).all(req.params.sessionId) as HttpRequestRow[],
    }))
  },

  onSessionDelete: (sessionId, ctx: ServerPluginContext) => {
    ctx.db.prepare(`DELETE FROM ${ctx.db.table('requests')} WHERE session_id = ?`).run(sessionId)
  },
}

export default plugin
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/plugin-http.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add examples/plugin-http/package.json examples/plugin-http/server.ts packages/server/test/plugin-http.test.ts
git commit -m "feat(examples): plugin-http server — matcher, transform, requests table, routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `plugin-http` UI — badge row + timeline detail view

**Files:**
- Create: `examples/plugin-http/timeline.ts`
- Create: `examples/plugin-http/ui.tsx`
- Test: `ui/src/test/timeline.test.ts`, `ui/src/test/httpPlugin.test.tsx`

**Interfaces:**
- Consumes: `UIPlugin`, `ListRowProps`, `DetailViewProps`, `FlatLogView`, `ThemeTokens` (`@coglet/logsafe-plugin-sdk/ui`); `HttpRequestRow` (from `./server` — type-only import); plugin routes from Task 1.
- Produces: default-exported `UIPlugin { type: 'http', ListRow: HttpListRow, DetailView: HttpDetailView }`; pure helper `layoutTimeline(requests, opts): TimelineLayout`.

- [ ] **Step 1: Write the failing geometry test**

The timeline math lives in a pure function so it's testable without JSDOM. `ui/src/test/timeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { layoutTimeline, barColor, MAX_TIMELINE_ROWS } from '../../../examples/plugin-http/timeline'

const req = (trace: string, ts: number, latency_ms: number | null, status: number | null) => ({
  session_id: 's1', trace, method: 'GET', path: '/', status, latency_ms, ts,
})
const TOKENS = { phos: 'PHOS', amber: 'AMBER', err: 'ERR' }

describe('layoutTimeline', () => {
  it('maps ts to x across the span and latency to width', () => {
    const rows = layoutTimeline([req('a', 1000, 100, 200), req('b', 3000, 200, 200)], { width: 600, axisStart: 100 })
    expect(rows[0].x).toBe(100)                    // first request at axis start
    expect(rows[1].x).toBe(600)                    // last request at the right edge
    expect(rows[1].width).toBeGreaterThan(rows[0].width) // width ∝ latency
  })

  it('single request centers on the axis without dividing by zero', () => {
    const rows = layoutTimeline([req('a', 1000, 100, 200)], { width: 600, axisStart: 100 })
    expect(Number.isFinite(rows[0].x)).toBe(true)
  })

  it('enforces the 2px minimum bar width (null latency included)', () => {
    const rows = layoutTimeline([req('a', 1000, 0, 200), req('b', 2000, null, 200)], { width: 600, axisStart: 100 })
    expect(rows[0].width).toBeGreaterThanOrEqual(2)
    expect(rows[1].width).toBeGreaterThanOrEqual(2)
  })

  it('caps rows at MAX_TIMELINE_ROWS keeping the newest', () => {
    const many = Array.from({ length: 50 }, (_, i) => req(`t${i}`, 1000 + i, 10, 200))
    const rows = layoutTimeline(many, { width: 600, axisStart: 100 })
    expect(rows).toHaveLength(MAX_TIMELINE_ROWS)
    expect(rows[rows.length - 1].request.trace).toBe('t49') // newest kept
  })
})

describe('barColor', () => {
  it('status buckets: ok -> phos, slow/4xx -> amber, 5xx -> err', () => {
    expect(barColor(req('a', 0, 100, 200), TOKENS as never)).toBe('PHOS')
    expect(barColor(req('a', 0, 100, 404), TOKENS as never)).toBe('AMBER')
    expect(barColor(req('a', 0, 1500, 200), TOKENS as never)).toBe('AMBER') // slow
    expect(barColor(req('a', 0, 100, 500), TOKENS as never)).toBe('ERR')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ui/src/test/timeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the geometry helper**

`examples/plugin-http/timeline.ts`:
```ts
// Pure timeline geometry for the http plugin's detail view — no React, no
// DOM, unit-testable. Maps request rows onto an SVG-ready layout.
import type { ThemeTokens } from '@coglet/logsafe-plugin-sdk/ui'
import type { HttpRequestRow } from './server'

export const MAX_TIMELINE_ROWS = 40
export const SLOW_MS = 1000
const MIN_BAR_PX = 2
// Widest bar (the max-latency request) takes this fraction of the axis.
const MAX_BAR_FRACTION = 0.35

export interface TimelineRow {
  request: HttpRequestRow
  x: number
  width: number
  y: number
}

export interface TimelineOpts {
  width: number      // total SVG width
  axisStart: number  // x where the time axis begins (label gutter to the left)
}

export function layoutTimeline(requests: HttpRequestRow[], opts: TimelineOpts): TimelineRow[] {
  const kept = requests.slice(-MAX_TIMELINE_ROWS) // newest wins (input is ts ASC)
  if (kept.length === 0) return []
  const t0 = kept[0].ts
  const span = Math.max(1, kept[kept.length - 1].ts - t0) // avoid /0 for a single request
  const axisWidth = opts.width - opts.axisStart
  const maxLatency = Math.max(1, ...kept.map((r) => r.latency_ms ?? 0))
  return kept.map((request, i) => ({
    request,
    x: opts.axisStart + ((request.ts - t0) / span) * axisWidth,
    width: Math.max(MIN_BAR_PX, ((request.latency_ms ?? 0) / maxLatency) * axisWidth * MAX_BAR_FRACTION),
    y: i,
  }))
}

export function barColor(r: HttpRequestRow, tokens: ThemeTokens): string {
  if (r.status !== null && r.status >= 500) return tokens.err
  if ((r.status !== null && r.status >= 400) || (r.latency_ms ?? 0) > SLOW_MS) return tokens.amber
  return tokens.phos
}
```

- [ ] **Step 4: Run geometry tests to verify they pass**

Run: `npx vitest run ui/src/test/timeline.test.ts`
Expected: PASS (6 tests). If an exact-value assertion (e.g. `rows[1].x`) disagrees with the formula, fix the TEST to the formula's true value — the formula above is the contract.

- [ ] **Step 5: Write the failing component test**

`ui/src/test/httpPlugin.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import httpUi from '../../../examples/plugin-http/ui'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import { LogsafeRuntimeProvider, type LogsafeRuntime, type SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

afterEach(cleanup)

const session = (types: string[]): SessionSummary => ({
  id: 's1', label: 'demo', first_ts: 0, last_ts: 5000, duration_ms: 5000, status: 'idle',
  event_count: 3, error_count: 0, warn_count: 0, sources: ['web'], types,
})

const REQUESTS = {
  requests: [
    { session_id: 's1', trace: 't1', method: 'GET',  path: '/',     status: 200, latency_ms: 120,  ts: 1000 },
    { session_id: 's1', trace: 't2', method: 'POST', path: '/vote', status: 200, latency_ms: 1500, ts: 2000 },
    { session_id: 's1', trace: 't3', method: 'POST', path: '/vote', status: 500, latency_ms: 88,   ts: 3000 },
  ],
}
const SUMMARY = { request_count: 3, error_count: 1, avg_latency_ms: 569, max_latency_ms: 1500 }

const TOKENS = {
  bg: 'var(--bg)', bgRaise: 'var(--bg-raise)', txt: 'var(--txt)', dim: 'var(--dim)', faint: 'var(--faint)',
  line: 'var(--line)', phos: 'var(--phos)', amber: 'var(--amber)', err: 'var(--err)', rowH: '20px', sources: [],
}
const runtime: LogsafeRuntime = {
  api: { fetchEventsPage: async () => ({ events: [], next_after_seq: null }), getSession: async () => null, exportUrl: () => '' },
  makePluginFetch: () => (async () => ({})) as never,
  FlatLogView: () => <div>FLAT-LOG-STUB</div>,
  useSessionEvents: () => ({ events: [], loading: false, tail: 'live', pause() {}, resume() {}, error: null }),
  tokens: TOKENS,
}

const pluginFetch = vi.fn(async (path: string) => (path.startsWith('/requests') ? REQUESTS : SUMMARY))
const setParams = vi.fn()

beforeEach(() => {
  pluginFetch.mockClear()
  setParams.mockClear()
})

function renderDetail() {
  const Detail = httpUi.DetailView!
  return render(
    <LogsafeRuntimeProvider value={runtime}>
      <Detail
        session={session(['generic', 'http'])} sessionId="s1"
        api={runtime.api} pluginFetch={pluginFetch as never}
        urlState={{ params: new URLSearchParams(), setParams }}
        tokens={TOKENS}
      />
    </LogsafeRuntimeProvider>,
  )
}

describe('plugin-http UI', () => {
  it('conforms to the contract and is resolved for http sessions', () => {
    expect(httpUi.type).toBe('http')
    const reg = buildRegistry([httpUi])
    expect(resolveViewOwner(session(['generic', 'http']), reg)).toBe(httpUi)
    expect(resolveViewOwner(session(['generic']), reg)).toBeUndefined()
  })

  it('detail view renders one timeline bar per request and composes the flat log', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getAllByTestId('timeline-bar')).toHaveLength(3))
    expect(screen.getByText('FLAT-LOG-STUB')).toBeTruthy()   // composed FlatLogView
    expect(screen.getByText(/3 reqs/)).toBeTruthy()           // summary strip
  })

  it('clicking a bar sets the trace filter through urlState', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getAllByTestId('timeline-bar')).toHaveLength(3))
    fireEvent.click(screen.getAllByTestId('timeline-bar')[1])
    expect(setParams).toHaveBeenCalled()
    const next = setParams.mock.calls[0][0] as URLSearchParams
    expect(next.get('trace')).toBe('t2')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run ui/src/test/httpPlugin.test.tsx`
Expected: FAIL — `examples/plugin-http/ui` not found.

- [ ] **Step 7: Implement the UI**

`examples/plugin-http/ui.tsx`:
```tsx
// logsafe-plugin-http — UI side. HttpListRow: summary badge fetched from the
// plugin's own route. HttpDetailView: summary strip + SVG request timeline
// (click a bar -> trace filter via urlState) + the core FlatLogView composed
// beneath. Plain SVG, themed only via the SDK tokens — no chart library.
import { useEffect, useState } from 'react'
import type { UIPlugin, ListRowProps, DetailViewProps, PluginFetch } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'
import { layoutTimeline, barColor, MAX_TIMELINE_ROWS } from './timeline'
import type { HttpRequestRow } from './server'

interface Summary { request_count: number; error_count: number; avg_latency_ms: number; max_latency_ms: number }

const SUMMARY_POLL_MS = 5000
const SVG_WIDTH = 700
const AXIS_START = 130
const ROW_H = 18

function useHttpData(sessionId: string, pluginFetch: PluginFetch, withRequests: boolean) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [requests, setRequests] = useState<HttpRequestRow[]>([])
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await pluginFetch<Summary>(`/summary/${encodeURIComponent(sessionId)}`)
        if (!cancelled) setSummary(s)
        if (withRequests) {
          const r = await pluginFetch<{ requests: HttpRequestRow[] }>(`/requests/${encodeURIComponent(sessionId)}`)
          if (!cancelled) setRequests(r.requests)
        }
      } catch (err) {
        console.error('[plugin-http] fetch failed:', err)
      }
    }
    void load()
    const iv = setInterval(() => void load(), SUMMARY_POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [sessionId, pluginFetch, withRequests])
  return { summary, requests }
}

function pct(n: number, of: number): string {
  return of === 0 ? '0%' : `${Math.round((n / of) * 100)}%`
}

function HttpListRow({ session, now: _now, selected, onOpen, onSelect, pluginFetch }: ListRowProps) {
  const { summary } = useHttpData(session.id, pluginFetch, false)
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className={`status ${session.status}`}>●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span style={{ color: 'var(--phos)', fontSize: '11px' }}>
        ⚡ http{summary ? ` · ${summary.request_count} reqs · ${pct(summary.error_count, summary.request_count)} err · avg ${summary.avg_latency_ms}ms` : ' · …'}
      </span>
    </div>
  )
}

function HttpDetailView({ session, sessionId, pluginFetch, urlState, tokens }: DetailViewProps) {
  const { summary, requests } = useHttpData(sessionId, pluginFetch, true)
  const rows = layoutTimeline(requests, { width: SVG_WIDTH, axisStart: AXIS_START })
  const svgHeight = 24 + rows.length * ROW_H

  const filterTrace = (trace: string) => {
    const next = new URLSearchParams(urlState.params)
    next.set('trace', trace)
    urlState.setParams(next, { replace: false })
  }

  return (
    <>
      <div style={{ padding: '8px 20px', color: tokens.phos, fontFamily: 'inherit', fontSize: '12px' }}>
        ⚡ http{summary ? ` — ${summary.request_count} reqs · ${pct(summary.error_count, summary.request_count)} err · avg ${summary.avg_latency_ms}ms · max ${summary.max_latency_ms}ms` : ' — loading…'}
        {requests.length > MAX_TIMELINE_ROWS && (
          <span style={{ color: tokens.dim }}> · showing latest {MAX_TIMELINE_ROWS} of {requests.length}</span>
        )}
      </div>
      {rows.length > 0 && (
        <svg viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`} style={{ width: '100%', display: 'block', padding: '0 20px 8px', boxSizing: 'border-box' }} role="img">
          <title>HTTP request timeline</title>
          <line x1={AXIS_START} y1={12} x2={SVG_WIDTH - 10} y2={12} stroke={tokens.line} />
          {rows.map((row) => (
            <g key={row.request.trace} transform={`translate(0, ${24 + row.y * ROW_H})`}>
              <text x={4} y={9} fontSize={10} fill={tokens.dim} fontFamily="inherit">
                {row.request.method ?? '?'} {row.request.path ?? ''}
              </text>
              <rect
                data-testid="timeline-bar"
                x={row.x} y={0} width={row.width} height={10} rx={2}
                fill={barColor(row.request, tokens)}
                style={{ cursor: 'pointer' }}
                onClick={() => filterTrace(row.request.trace)}
              />
              <text x={row.x + row.width + 6} y={9} fontSize={9} fill={tokens.dim} fontFamily="inherit">
                {row.request.latency_ms ?? '?'}ms · {row.request.status ?? '—'}
              </text>
            </g>
          ))}
        </svg>
      )}
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}

const plugin: UIPlugin = { type: 'http', ListRow: HttpListRow, DetailView: HttpDetailView }
export default plugin
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run ui/src/test/httpPlugin.test.tsx ui/src/test/timeline.test.ts`
Expected: PASS (8 tests total: 5 timeline + 3 component).

- [ ] **Step 9: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add examples/plugin-http/timeline.ts examples/plugin-http/ui.tsx ui/src/test/timeline.test.ts ui/src/test/httpPlugin.test.tsx
git commit -m "feat(examples): plugin-http UI — badge row + SVG request timeline detail view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `templates/plugin-starter`

**Files:**
- Create: `templates/plugin-starter/package.json`, `templates/plugin-starter/server.ts`, `templates/plugin-starter/ui.tsx`, `templates/plugin-starter/README.md`
- Test: `ui/src/test/starterTemplate.test.tsx`

**Interfaces:**
- Consumes: the SDK contracts only.
- Produces: a compiling starter package with placeholder id `my-plugin`.

- [ ] **Step 1: Write the failing type-conformance test**

`ui/src/test/starterTemplate.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import starterUi from '../../../templates/plugin-starter/ui'
import starterServer from '../../../templates/plugin-starter/server'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import type { SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

const session = (types: string[]): SessionSummary => ({
  id: 's', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle',
  event_count: 0, error_count: 0, warn_count: 0, sources: [], types,
})

describe('plugin-starter template', () => {
  it('compiles against the SDK and resolves for its type', () => {
    expect(starterUi.type).toBe('my-plugin')
    expect(typeof starterServer.matchType).toBe('function')
    const reg = buildRegistry([starterUi])
    expect(resolveViewOwner(session(['my-plugin']), reg)).toBe(starterUi)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ui/src/test/starterTemplate.test.tsx`
Expected: FAIL — template modules not found.

- [ ] **Step 3: Create the template**

`templates/plugin-starter/package.json`:
```json
{
  "name": "logsafe-plugin-my-plugin",
  "version": "0.0.1",
  "type": "module",
  "exports": { "./server": "./server.ts", "./ui": "./ui.tsx" },
  "peerDependencies": { "@coglet/logsafe-plugin-sdk": "*", "react": "^19" },
  "logsafe": {
    "id": "my-plugin", "version": "0.0.1", "apiVersion": "1",
    "ownedTypes": ["my-plugin"], "priority": 1,
    "server": "./server.ts", "ui": "./ui.tsx"
  }
}
```

`templates/plugin-starter/server.ts`:
```ts
// Starter server plugin. TODO: rename 'my-plugin' everywhere (package.json
// too), then edit matchType to claim your events. Every other hook is
// optional — uncomment what you need. Docs: docs/PLUGINS.md
import type { ServerPlugin } from '@coglet/logsafe-plugin-sdk/server'

const plugin: ServerPlugin = {
  // TODO: claim your events. Return your type string, or null to pass.
  matchType: (e) => (e.ns.startsWith('my-plugin:') ? 'my-plugin' : null),

  // transform: (e) => ({ ...e, ctx: { ...(e.ctx as object), enriched: true } }),
  // migrate: (ctx) => { ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('things')} (session_id TEXT, value REAL)`) },
  // afterInsert: (events, ctx) => { /* derive + write to your plugin_<id>_* tables */ },
  // routes: (router, ctx) => { router.get('/things/:sessionId', (req) => ({ sessionId: req.params.sessionId })) },
  // onSessionDelete: (sessionId, ctx) => { ctx.db.prepare(`DELETE FROM ${ctx.db.table('things')} WHERE session_id = ?`).run(sessionId) },
}

export default plugin
```

`templates/plugin-starter/ui.tsx`:
```tsx
// Starter UI plugin. TODO: rename 'my-plugin', then build your row + detail
// view. FlatLogView composes the core log stream under your custom UI.
// Docs: docs/PLUGINS.md (recipes for visuals, live tail, pluginFetch).
import type { UIPlugin, ListRowProps, DetailViewProps } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'

function MyRow({ session, selected, onOpen, onSelect }: ListRowProps) {
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className={`status ${session.status}`}>●</span>
      <span className="label">{session.label ?? session.id}</span>
      {/* TODO: your badge — fetch plugin data via the pluginFetch prop */}
      <span style={{ color: 'var(--phos)' }}>my-plugin · {session.event_count} evts</span>
    </div>
  )
}

function MyDetail({ session, sessionId, tokens }: DetailViewProps) {
  return (
    <>
      {/* TODO: your custom view — see plugin-http's SVG timeline for a visual example */}
      <div style={{ padding: '8px 20px', color: tokens.phos }}>my-plugin — custom view for {session?.label ?? sessionId}</div>
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}

const plugin: UIPlugin = { type: 'my-plugin', ListRow: MyRow, DetailView: MyDetail }
export default plugin
```

`templates/plugin-starter/README.md`:
```markdown
# logsafe plugin starter

Five steps to your own plugin:

1. **Copy** this directory somewhere (e.g. `cp -r templates/plugin-starter ../my-plugin`).
2. **Rename** the id: replace every `my-plugin` in `package.json` (both the
   package name and the `logsafe` manifest) and in `server.ts` / `ui.tsx`.
3. **Edit the matcher** in `server.ts` so `matchType` claims your events
   (by `ns`, `source`, or anything on the event). Ingest can also set an
   explicit `type` field, which wins over matchers.
4. **Enable it**: add the path or package name to `logsafe.config.json`:
   `{ "plugins": ["../my-plugin"] }`
5. **Build + restart**: `npm run build:ui` then restart the server. The
   server logs `loaded 1 plugin(s): <id>` on startup.

Recipes (custom visuals, live tail, your own API routes): `docs/PLUGINS.md`.
Full worked example: `examples/plugin-http`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run ui/src/test/starterTemplate.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck, commit**

Run: `npm run typecheck && npm test` — PASS. Then:
```bash
git add templates/plugin-starter ui/src/test/starterTemplate.test.tsx
git commit -m "feat(templates): plugin-starter — copyable plugin skeleton with conformance test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `docs/PLUGINS.md` authoring guide + README link

**Files:**
- Create: `docs/PLUGINS.md`
- Modify: `README.md` (one line under the docs/links section)

**Interfaces:** none (documentation). Content contract: every code snippet in the guide must be copied from (or consistent with) the real files it references — `examples/plugin-hello`, `examples/plugin-http`, `templates/plugin-starter`, the SDK types. No invented APIs.

- [ ] **Step 1: Write the guide**

`docs/PLUGINS.md` with these sections (each with a short working snippet; keep the whole file focused, ~250–350 lines):

1. **What a plugin is** — package layout, the `logsafe` manifest field table (`id`, `version`, `apiVersion`, `ownedTypes`, `priority`, `server`, `ui`), how types are resolved (explicit `type` field → matchers by priority → `generic`), and how a session's view owner is picked.
2. **Install & enable** — `logsafe.config.json`, `npm run plugins:sync`, `npm run build:ui`, restart; what the startup log shows; what happens when a plugin ISN'T installed (flat view + note banner).
3. **Server hooks** — a table of all eight hooks with one-line when-to-use, then short snippets for `matchType`, `transform` (note the parsed-ctx round trip), `migrate` + the `plugin_<id>_*` naming rule via `ctx.db.table()`, `afterInsert` ("keep it fast" + link issue #5), `routes` (mount point `/api/plugins/<id>/`), `onSessionDelete` (fires on delete, purge-to-empty, and retention prune).
4. **UI recipes** — each 10–25 lines, lifted from the real examples:
   - *Custom list row* (grid caveat: own the whole row; per-row fetch caveat).
   - *Custom detail view + composing FlatLogView* (with and without `baseFilters`).
   - *Drawing a custom visual* — the http timeline distilled: pure-geometry helper + SVG + `tokens` colors + `urlState` interaction (click → `trace=` filter).
   - *Live events* via `useSessionEvents`.
   - *Fetching your own routes* via `pluginFetch` (leading slash optional).
   - *Theming* — the `tokens` prop ↔ CSS custom properties table.
5. **Testing your plugin** — pointer to `httpPlugin.test.tsx` / `starterTemplate.test.tsx` patterns (contract conformance + rendering with a stub `LogsafeRuntimeProvider`).
6. **Rules & gotchas** — write only `plugin_<id>_*` tables; matchers run only for still-generic events; `afterInsert` runs on the ingest hot path; apiVersion gate; UI registry is build-time (rebuild after config changes).

- [ ] **Step 2: Link from README**

In `README.md`, add one line where other docs are referenced (match surrounding style):
```markdown
- **[Writing plugins](docs/PLUGINS.md)** — extend logsafe with your own log types, server hooks, and custom UI (see `examples/plugin-http` and `templates/plugin-starter`).
```

- [ ] **Step 3: Verify snippets compile conceptually**

Cross-check every snippet against the real source files it mirrors (imports, prop names, route paths). Fix drift in the guide, never in the source.

- [ ] **Step 4: Full suite + typecheck (docs-only change, still run once), commit**

```bash
git add docs/PLUGINS.md README.md
git commit -m "docs: plugin authoring guide (PLUGINS.md) + README link

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npm run typecheck && npm test` — all green.
- [ ] `ui/src/plugins.generated.ts` still the committed empty stub; no `logsafe.config.json` committed.
- [ ] Optional live acceptance (mirrors the voting-app demo): set `logsafe.config.json` to `{ "plugins": ["./examples/plugin-http"] }`, `npm run plugins:sync && npm run build:ui`, start the server with a scratch `LOGSAFE_DB`, POST a few `ns:'http'` events with `ctx: { method, path, status, latency_ms }`, and verify the ⚡ badge in the list and the clickable timeline over the flat log in detail. Revert `logsafe.config.json` + re-run `plugins:sync` afterwards.
- [ ] Push to the PR #2 branch.
