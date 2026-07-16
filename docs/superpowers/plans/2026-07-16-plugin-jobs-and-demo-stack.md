# plugin-jobs + Docker Demo Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `examples/plugin-jobs` (the Option B visual — stat cards + duration sparkline — over a stateful job-lifecycle derivation) and `examples/demo-stack` (a self-contained `docker compose up` demo running containerized logsafe + three log-generator services).

**Architecture:** Task 1 builds the jobs plugin's server half (lifecycle upsert table, summary/durations routes) tested through the real app pipeline. Task 2 builds the UI (pure `sparkline.ts` geometry + stat-cards/sparkline DetailView). Task 3 builds the demo stack (gitignore anchor, Dockerfiles, compose, three dependency-free generator scripts, README) with a docker-based acceptance. Tasks are sequential — the stack's config references the plugin.

**Tech Stack:** TypeScript (NodeNext, strict), React 19, `@coglet/logsafe-plugin-sdk`, plain SVG, Vitest 4 + jsdom, Docker Compose (node:20-slim for logsafe, node:20-alpine for generators).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-16-plugin-jobs-and-demo-stack-design.md` — values below are copied from it.
- **Branch/delivery:** a NEW PR. Branch `claude/plugin-jobs-demo-stack` off `main` once PR #2 has merged; if #2 is still open when execution starts, branch off `claude/debug-log-plugin-system-3a31ee` instead and retarget after the merge.
- Tests: `npm test` from repo root; single file via `npx vitest run <path>`; React tests MUST start with `// @vitest-environment jsdom`. `npm run typecheck` stays green.
- Plugin: id `jobs`, `apiVersion "1"`, `ownedTypes ["job"]`, `priority 4`. Table `plugin_jobs_runs` (always via `ctx.db.table('runs')`), PK `(session_id, job_id)`, `status ∈ 'running'|'done'|'failed'`.
- Lifecycle rules: `start` → INSERT running, must NOT overwrite an existing final status (but fills a NULL `name`); `done`/`failed` → final status + `duration_ms` + `ts`, creating the row if no `start` was seen.
- Visual: 4 stat cards (`PROCESSED`, `FAILED %`, `AVG DUR`, `MAX DUR`), sparkline `MAX_SPARKLINE_POINTS = 120` (newest kept), slow threshold `1000`ms, poll `SUMMARY_POLL_MS = 5000`, all colors from `tokens`, no chart library, no urlState interaction.
- Demo stack: logsafe binds via `LOGSAFE_HOST=0.0.0.0` inside the container; compose maps `127.0.0.1:4600:4600`; generators POST to `http://logsafe:4600/v1/log`; three sessions `api-gateway` / `job-worker` / `webapp`.
- `.gitignore`'s `logsafe.config.json` line MUST be anchored to `/logsafe.config.json` so `examples/demo-stack/logsafe.config.json` can be committed.
- Commit after every task; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- Create: `examples/plugin-jobs/{package.json,server.ts,sparkline.ts,ui.tsx}`
- Create: `examples/demo-stack/{docker-compose.yml,Dockerfile.logsafe,logsafe.config.json,README.md}`, `examples/demo-stack/generators/{Dockerfile.generator,gateway.mjs,worker.mjs,webapp.mjs}`, repo-root `.dockerignore`
- Modify: `.gitignore` (anchor line), `docs/PLUGINS.md` (worked-examples pointer, one line)
- Test: `packages/server/test/plugin-jobs.test.ts`, `ui/src/test/sparkline.test.ts`, `ui/src/test/jobsPlugin.test.tsx`

---

### Task 1: `plugin-jobs` server side

**Files:**
- Create: `examples/plugin-jobs/package.json`, `examples/plugin-jobs/server.ts`
- Test: `packages/server/test/plugin-jobs.test.ts`

**Interfaces:**
- Consumes: `ServerPlugin`/`StoredEvent` (SDK server), `makePluginContext`, `buildApp`, `openDb` — same harness as `packages/server/test/plugin-http.test.ts` (read it first; mirror its structure).
- Produces: default-exported `ServerPlugin` for type `job`; `interface JobRun { session_id: string; job_id: string; name: string | null; status: 'running' | 'done' | 'failed'; duration_ms: number | null; ts: number }`; routes `GET /api/plugins/jobs/summary/:sessionId` → `{ processed, running, failed, failure_rate_pct, avg_duration_ms, max_duration_ms }` and `GET /api/plugins/jobs/durations/:sessionId` → `{ runs: JobRun[] }` (completed only, ts ASC).

- [ ] **Step 1: Create the manifest**

`examples/plugin-jobs/package.json`:
```json
{
  "name": "logsafe-plugin-jobs",
  "version": "0.1.0",
  "type": "module",
  "exports": { "./server": "./server.ts", "./ui": "./ui.tsx" },
  "peerDependencies": { "@coglet/logsafe-plugin-sdk": "*", "react": "^19" },
  "logsafe": {
    "id": "jobs", "version": "0.1.0", "apiVersion": "1",
    "ownedTypes": ["job"], "priority": 4,
    "server": "./server.ts", "ui": "./ui.tsx"
  }
}
```

- [ ] **Step 2: Write the failing test**

`packages/server/test/plugin-jobs.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { makePluginContext } from '../src/plugins/context.js'
import type { LoadedServerPlugin } from '../src/plugins/loader.js'
import jobsPlugin from '../../../examples/plugin-jobs/server'

const MANIFEST = { id: 'jobs', version: '0.1.0', apiVersion: '1', ownedTypes: ['job'], priority: 4 }

function loaded(db: Db): LoadedServerPlugin {
  const ctx = makePluginContext(db, 'jobs')
  jobsPlugin.migrate?.(ctx)
  return { manifest: MANIFEST, plugin: jobsPlugin, ctx }
}

const ev = (event: string, job_id: string, extra: Record<string, unknown> = {}) => ({
  msg: `${event} ${job_id}`, session_id: 's1', source: 'worker', ns: 'job:resize',
  ctx: { job_id, name: 'resize', event, ...extra },
})

describe('plugin-jobs server', () => {
  let db: Db
  let app: ReturnType<typeof buildApp>
  beforeEach(() => {
    db = openDb(':memory:')
    app = buildApp({ db, plugins: [loaded(db)] })
  })

  const post = (events: unknown[]) => app.inject({ method: 'POST', url: '/v1/log', payload: events })
  const summary = async () => (await app.inject({ method: 'GET', url: '/api/plugins/jobs/summary/s1' })).json()
  const runs = async () => (await app.inject({ method: 'GET', url: '/api/plugins/jobs/durations/s1' })).json().runs

  it('claims job:* events; start creates a running row', async () => {
    await post([ev('start', 'j1'), { msg: 'other', session_id: 's1', source: 'worker', ns: 'app' }])
    const events = (await app.inject({ method: 'GET', url: '/api/sessions/s1/events' })).json().events
    expect(events.find((e: { ns: string }) => e.ns === 'job:resize').type).toBe('job')
    expect(events.find((e: { ns: string }) => e.ns === 'app').type).toBe('generic')
    expect(await summary()).toEqual({ processed: 0, running: 1, failed: 0, failure_rate_pct: 0, avg_duration_ms: 0, max_duration_ms: 0 })
  })

  it('done finalizes with duration; failed counts; summary aggregates over completed only', async () => {
    await post([ev('start', 'j1'), ev('start', 'j2'), ev('start', 'j3')])
    await post([ev('done', 'j1', { duration_ms: 200 }), ev('failed', 'j2', { duration_ms: 800 })])
    expect(await summary()).toEqual({
      processed: 2, running: 1, failed: 1, failure_rate_pct: 50,
      avg_duration_ms: 500, max_duration_ms: 800,
    })
    expect((await runs()).map((r: JobLike) => [r.job_id, r.status, r.duration_ms]))
      .toEqual([['j1', 'done', 200], ['j2', 'failed', 800]]) // completed only, ts ASC
  })

  it('a late/replayed start does not resurrect a finished run', async () => {
    await post([ev('start', 'j1')])
    await post([ev('done', 'j1', { duration_ms: 150 })])
    await post([ev('start', 'j1')]) // replay
    const r = (await runs()).find((x: JobLike) => x.job_id === 'j1')
    expect(r.status).toBe('done')
    expect(r.duration_ms).toBe(150)
  })

  it('an out-of-order final with no prior start still creates the row', async () => {
    await post([ev('done', 'orphan', { duration_ms: 99 })])
    expect((await runs()).find((x: JobLike) => x.job_id === 'orphan').status).toBe('done')
  })

  it('ignores claimed events without job_id/event; cleans rows on session delete', async () => {
    await post([{ msg: 'job chatter', session_id: 's1', source: 'worker', ns: 'job', ctx: { note: 'no lifecycle' } }, ev('start', 'j9')])
    expect((await summary()).running).toBe(1) // chatter ignored
    await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })
    const c = db.prepare('SELECT COUNT(*) c FROM plugin_jobs_runs').get() as { c: number }
    expect(c.c).toBe(0)
  })
})

interface JobLike { job_id: string; status: string; duration_ms: number | null }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/server/test/plugin-jobs.test.ts`
Expected: FAIL — cannot resolve `../../../examples/plugin-jobs/server`.

- [ ] **Step 4: Implement the server plugin**

`examples/plugin-jobs/server.ts`:
```ts
// logsafe-plugin-jobs — server side. Claims job/job:* lifecycle events and
// derives a per-run row (stateful: start -> running, done/failed -> final),
// keyed (session_id, job_id) so replays and out-of-order finals are safe.
import type { ServerPlugin, StoredEvent } from '@coglet/logsafe-plugin-sdk/server'

export interface JobRun {
  session_id: string
  job_id: string
  name: string | null
  status: 'running' | 'done' | 'failed'
  duration_ms: number | null
  ts: number
}

function lifecycle(e: StoredEvent): { job_id: string; name: string | null; event: string; duration_ms: number | null } | null {
  const c = e.ctx
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return null
  const r = c as Record<string, unknown>
  if (typeof r.job_id !== 'string' || typeof r.event !== 'string') return null
  return {
    job_id: r.job_id,
    name: typeof r.name === 'string' ? r.name : null,
    event: r.event,
    duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : null,
  }
}

const plugin: ServerPlugin = {
  matchType: (e) => (e.ns === 'job' || e.ns.startsWith('job:') ? 'job' : null),

  migrate: (ctx) => {
    ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('runs')} (
      session_id  TEXT NOT NULL,
      job_id      TEXT NOT NULL,
      name        TEXT,
      status      TEXT NOT NULL,
      duration_ms INTEGER,
      ts          INTEGER NOT NULL,
      PRIMARY KEY (session_id, job_id)
    )`)
  },

  afterInsert: (events, ctx) => {
    // A start must never overwrite a final status (replay-safe); it only
    // creates the running row or fills a missing name.
    const start = ctx.db.prepare(`
      INSERT INTO ${ctx.db.table('runs')} (session_id, job_id, name, status, duration_ms, ts)
      VALUES (?, ?, ?, 'running', NULL, ?)
      ON CONFLICT(session_id, job_id) DO UPDATE SET name = coalesce(name, excluded.name)
    `)
    // A final creates-or-finalizes regardless of whether start was seen.
    const final = ctx.db.prepare(`
      INSERT INTO ${ctx.db.table('runs')} (session_id, job_id, name, status, duration_ms, ts)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, job_id) DO UPDATE SET
        status = excluded.status, duration_ms = excluded.duration_ms,
        ts = excluded.ts, name = coalesce(excluded.name, name)
    `)
    for (const e of events) {
      const l = lifecycle(e)
      if (!l) continue
      if (l.event === 'start') start.run(e.session_id, l.job_id, l.name, e.ts)
      else if (l.event === 'done' || l.event === 'failed') {
        final.run(e.session_id, l.job_id, l.name, l.event, l.duration_ms, e.ts)
      }
    }
  },

  routes: (router, ctx) => {
    router.get('/summary/:sessionId', (req) => {
      const agg = ctx.db.prepare(`
        SELECT
          coalesce(sum(status != 'running'), 0)            AS processed,
          coalesce(sum(status = 'running'), 0)             AS running,
          coalesce(sum(status = 'failed'), 0)              AS failed,
          coalesce(avg(CASE WHEN status != 'running' THEN duration_ms END), 0) AS avg_dur,
          coalesce(max(CASE WHEN status != 'running' THEN duration_ms END), 0) AS max_dur
        FROM ${ctx.db.table('runs')} WHERE session_id = ?
      `).get(req.params.sessionId) as { processed: number; running: number; failed: number; avg_dur: number; max_dur: number }
      return {
        processed: agg.processed,
        running: agg.running,
        failed: agg.failed,
        failure_rate_pct: agg.processed === 0 ? 0 : Math.round((agg.failed / agg.processed) * 100),
        avg_duration_ms: Math.round(agg.avg_dur),
        max_duration_ms: agg.max_dur,
      }
    })
    router.get('/durations/:sessionId', (req) => ({
      runs: ctx.db.prepare(
        `SELECT * FROM ${ctx.db.table('runs')} WHERE session_id = ? AND status != 'running' ORDER BY ts ASC`,
      ).all(req.params.sessionId) as JobRun[],
    }))
  },

  onSessionDelete: (sessionId, ctx) => {
    ctx.db.prepare(`DELETE FROM ${ctx.db.table('runs')} WHERE session_id = ?`).run(sessionId)
  },
}

export default plugin
```
> Note: no `transform` — deliberate (spec §2.3); http demonstrates it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/plugin-jobs.test.ts`
Expected: PASS (5 tests). If `failure_rate_pct`/`avg` rounding disagrees, re-derive from the SQL: test 2 expects processed=2, failed=1 → 50%; avg (200+800)/2 = 500.

- [ ] **Step 6: Full suite + typecheck, commit**

Run: `npm run typecheck && npm test` — PASS.
```bash
git add examples/plugin-jobs/package.json examples/plugin-jobs/server.ts packages/server/test/plugin-jobs.test.ts
git commit -m "feat(examples): plugin-jobs server — stateful lifecycle table, summary/durations routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `plugin-jobs` UI — stat cards + sparkline

**Files:**
- Create: `examples/plugin-jobs/sparkline.ts`, `examples/plugin-jobs/ui.tsx`
- Modify: `docs/PLUGINS.md` (add plugin-jobs to the worked-examples list, one line)
- Test: `ui/src/test/sparkline.test.ts`, `ui/src/test/jobsPlugin.test.tsx`

**Interfaces:**
- Consumes: `UIPlugin`/`ListRowProps`/`DetailViewProps`/`FlatLogView`/`ThemeTokens` (SDK ui); `JobRun` (type-only from `./server`); Task 1's routes. Read `examples/plugin-http/{timeline.ts,ui.tsx}` and `ui/src/test/{timeline.test.ts,httpPlugin.test.tsx}` first — this task mirrors them.
- Produces: `layoutSparkline(runs, opts): SparklinePoint[]`, `pointColor(run, tokens): string`, `MAX_SPARKLINE_POINTS = 120`; default-exported `UIPlugin { type: 'job', ListRow: JobsListRow, DetailView: JobsDetailView }`.

- [ ] **Step 1: Write the failing geometry test**

`ui/src/test/sparkline.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { layoutSparkline, pointColor, MAX_SPARKLINE_POINTS } from '../../../examples/plugin-jobs/sparkline'

const run = (job_id: string, ts: number, duration_ms: number, status = 'done') => ({
  session_id: 's', job_id, name: 'n', status: status as 'done' | 'failed', duration_ms, ts,
})
const TOKENS = { phos: 'PHOS', amber: 'AMBER', err: 'ERR' }
const OPTS = { width: 600, height: 60 }

describe('layoutSparkline', () => {
  it('maps ts to x across the span and duration to y (taller = higher)', () => {
    const pts = layoutSparkline([run('a', 1000, 100), run('b', 3000, 400)], OPTS)
    expect(pts[0].x).toBe(0)
    expect(pts[1].x).toBe(600)
    expect(pts[1].y).toBeLessThan(pts[0].y) // longer duration sits higher (smaller y)
    expect(pts.every((p) => p.y >= 0 && p.y <= 60)).toBe(true)
  })

  it('is safe for a single point (no /0)', () => {
    const pts = layoutSparkline([run('a', 1000, 100)], OPTS)
    expect(Number.isFinite(pts[0].x)).toBe(true)
    expect(Number.isFinite(pts[0].y)).toBe(true)
  })

  it('caps at MAX_SPARKLINE_POINTS keeping the newest', () => {
    const many = Array.from({ length: 150 }, (_, i) => run(`j${i}`, 1000 + i, 10))
    const pts = layoutSparkline(many, OPTS)
    expect(pts).toHaveLength(MAX_SPARKLINE_POINTS)
    expect(pts[pts.length - 1].run.job_id).toBe('j149')
  })
})

describe('pointColor', () => {
  it('failed -> err, slow -> amber, else phos', () => {
    expect(pointColor(run('a', 0, 100, 'failed'), TOKENS as never)).toBe('ERR')
    expect(pointColor(run('a', 0, 1500), TOKENS as never)).toBe('AMBER')
    expect(pointColor(run('a', 0, 100), TOKENS as never)).toBe('PHOS')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run ui/src/test/sparkline.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the geometry**

`examples/plugin-jobs/sparkline.ts`:
```ts
// Pure sparkline geometry for the jobs plugin — no React, no DOM.
import type { ThemeTokens } from '@coglet/logsafe-plugin-sdk/ui'
import type { JobRun } from './server'

export const MAX_SPARKLINE_POINTS = 120
export const SLOW_MS = 1000
const TOP_PAD = 4 // keep the max-duration point off the very top edge

export interface SparklinePoint { run: JobRun; x: number; y: number }
export interface SparklineOpts { width: number; height: number }

export function layoutSparkline(runs: JobRun[], opts: SparklineOpts): SparklinePoint[] {
  const kept = runs.slice(-MAX_SPARKLINE_POINTS) // input is ts ASC; newest kept
  if (kept.length === 0) return []
  const t0 = kept[0].ts
  const span = Math.max(1, kept[kept.length - 1].ts - t0)
  const maxDur = Math.max(1, ...kept.map((r) => r.duration_ms ?? 0))
  return kept.map((run) => ({
    run,
    x: ((run.ts - t0) / span) * opts.width,
    y: opts.height - ((run.duration_ms ?? 0) / maxDur) * (opts.height - TOP_PAD),
  }))
}

export function pointColor(r: JobRun, tokens: ThemeTokens): string {
  if (r.status === 'failed') return tokens.err
  if ((r.duration_ms ?? 0) > SLOW_MS) return tokens.amber
  return tokens.phos
}
```

- [ ] **Step 4: Run geometry tests** — `npx vitest run ui/src/test/sparkline.test.ts` → PASS (4 tests). If an exact value disagrees, the formula above is the contract — fix whichever side deviates and note it.

- [ ] **Step 5: Write the failing component test**

`ui/src/test/jobsPlugin.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import jobsUi from '../../../examples/plugin-jobs/ui'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import { LogsafeRuntimeProvider, type LogsafeRuntime, type SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const session = (types: string[]): SessionSummary => ({
  id: 's1', label: 'jobs demo', first_ts: 0, last_ts: 9000, duration_ms: 9000, status: 'idle',
  event_count: 6, error_count: 0, warn_count: 0, sources: ['worker'], types,
})

const SUMMARY = { processed: 3, running: 1, failed: 1, failure_rate_pct: 33, avg_duration_ms: 480, max_duration_ms: 1200 }
const RUNS = {
  runs: [
    { session_id: 's1', job_id: 'j1', name: 'resize', status: 'done',   duration_ms: 140,  ts: 1000 },
    { session_id: 's1', job_id: 'j2', name: 'resize', status: 'failed', duration_ms: 1200, ts: 2000 },
    { session_id: 's1', job_id: 'j3', name: 'email',  status: 'done',   duration_ms: 100,  ts: 3000 },
  ],
}

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
const pluginFetch = vi.fn(async (path: string) => (path.startsWith('/durations') ? RUNS : SUMMARY))

function renderDetail() {
  const Detail = jobsUi.DetailView!
  return render(
    <LogsafeRuntimeProvider value={runtime}>
      <Detail session={session(['generic', 'job'])} sessionId="s1" api={runtime.api}
        pluginFetch={pluginFetch as never}
        urlState={{ params: new URLSearchParams(), setParams: vi.fn() }} tokens={TOKENS} />
    </LogsafeRuntimeProvider>,
  )
}

describe('plugin-jobs UI', () => {
  it('conforms to the contract and resolves for job sessions', () => {
    expect(jobsUi.type).toBe('job')
    const reg = buildRegistry([jobsUi])
    expect(resolveViewOwner(session(['generic', 'job']), reg)).toBe(jobsUi)
    expect(resolveViewOwner(session(['generic']), reg)).toBeUndefined()
  })

  it('renders the four stat cards with summary values and composes the flat log', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('PROCESSED')).toBeTruthy())
    expect(screen.getByText('3')).toBeTruthy()          // processed
    expect(screen.getByText('33%')).toBeTruthy()        // failed %
    expect(screen.getByText(/480/)).toBeTruthy()        // avg dur
    expect(screen.getByText(/1200|1\.2/)).toBeTruthy()  // max dur
    expect(screen.getByText('FLAT-LOG-STUB')).toBeTruthy()
  })

  it('renders the sparkline with one marker per completed run, failure in err color', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getAllByTestId('spark-point')).toHaveLength(3))
    const failed = screen.getAllByTestId('spark-point').find((el) => el.getAttribute('fill') === 'var(--err)')
    expect(failed).toBeTruthy()
  })
})
```

- [ ] **Step 6: Run to verify it fails** — `npx vitest run ui/src/test/jobsPlugin.test.tsx` → FAIL (ui module not found).

- [ ] **Step 7: Implement the UI**

`examples/plugin-jobs/ui.tsx`:
```tsx
// logsafe-plugin-jobs — UI side. Option B visual: stat cards + duration
// sparkline over the composed FlatLogView. Read-only (no urlState use —
// see plugin-http's timeline for click-to-filter). Colors from tokens only.
import { useEffect, useState } from 'react'
import type { UIPlugin, ListRowProps, DetailViewProps, PluginFetch, ThemeTokens } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'
import { layoutSparkline, pointColor, MAX_SPARKLINE_POINTS, SLOW_MS } from './sparkline'
import type { JobRun } from './server'

interface Summary {
  processed: number; running: number; failed: number
  failure_rate_pct: number; avg_duration_ms: number; max_duration_ms: number
}

const SUMMARY_POLL_MS = 5000
const SPARK_W = 700
const SPARK_H = 60

function useJobsData(sessionId: string, pluginFetch: PluginFetch, withRuns: boolean) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [runsList, setRunsList] = useState<JobRun[]>([])
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await pluginFetch<Summary>(`/summary/${encodeURIComponent(sessionId)}`)
        if (!cancelled) setSummary(s)
        if (withRuns) {
          const r = await pluginFetch<{ runs: JobRun[] }>(`/durations/${encodeURIComponent(sessionId)}`)
          if (!cancelled) setRunsList(r.runs)
        }
      } catch (err) {
        console.error('[plugin-jobs] fetch failed:', err)
      }
    }
    void load()
    const iv = setInterval(() => void load(), SUMMARY_POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [sessionId, pluginFetch, withRuns])
  return { summary, runsList }
}

function JobsListRow({ session, selected, onOpen, onSelect, pluginFetch }: ListRowProps) {
  const { summary } = useJobsData(session.id, pluginFetch, false)
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className={`status ${session.status}`}>●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span style={{ color: 'var(--phos)', fontSize: '11px' }}>
        ⚙ jobs{summary ? ` · ${summary.processed} done · ${summary.failure_rate_pct}% fail · avg ${summary.avg_duration_ms}ms` : ' · …'}
      </span>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: 'var(--dim)' }}>{label}</div>
      <div style={{ fontSize: 18, color: color ?? 'var(--txt)' }}>{value}</div>
    </div>
  )
}

function JobsDetailView({ session, sessionId, pluginFetch, tokens }: DetailViewProps) {
  const { summary, runsList } = useJobsData(sessionId, pluginFetch, true)
  const points = layoutSparkline(runsList, { width: SPARK_W, height: SPARK_H })
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <>
      <div style={{ display: 'flex', gap: 10, padding: '10px 20px', fontFamily: 'inherit' }}>
        <StatCard label="PROCESSED" value={String(summary?.processed ?? '…')} />
        <StatCard label="FAILED %" value={`${summary?.failure_rate_pct ?? '…'}%`}
          color={(summary?.failed ?? 0) > 0 ? tokens.err : undefined} />
        <StatCard label="AVG DUR" value={`${summary?.avg_duration_ms ?? '…'}ms`} />
        <StatCard label="MAX DUR" value={`${summary?.max_duration_ms ?? '…'}ms`}
          color={(summary?.max_duration_ms ?? 0) > SLOW_MS ? tokens.amber : undefined} />
      </div>
      {points.length > 0 && (
        <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H + 8}`} role="img"
          style={{ width: '100%', display: 'block', padding: '0 20px 8px', boxSizing: 'border-box' }}>
          <title>Job duration sparkline</title>
          <line x1={0} y1={SPARK_H + 2} x2={SPARK_W} y2={SPARK_H + 2} stroke={tokens.line} />
          <polyline points={polyline} fill="none" stroke={tokens.phos} strokeWidth={1.5} />
          {points.map((p) => (
            <circle key={p.run.job_id} data-testid="spark-point"
              cx={p.x} cy={p.y} r={3} fill={pointColor(p.run, tokens)} />
          ))}
          {runsList.length > MAX_SPARKLINE_POINTS && (
            <text x={4} y={10} fontSize={9} fill={tokens.dim}>latest {MAX_SPARKLINE_POINTS} of {runsList.length}</text>
          )}
        </svg>
      )}
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}

const plugin: UIPlugin = { type: 'job', ListRow: JobsListRow, DetailView: JobsDetailView }
export default plugin
```
> `ThemeTokens` import is type-only via the props; drop the named import if unused after transcription (typecheck will flag it).

- [ ] **Step 8: Run component tests** — `npx vitest run ui/src/test/jobsPlugin.test.tsx ui/src/test/sparkline.test.ts` → PASS (7 tests).

- [ ] **Step 9: Add the worked-example pointer to `docs/PLUGINS.md`**

In the guide's worked-examples list (final section pointing at plugin-hello / plugin-http / plugin-starter), add:
```markdown
- `examples/plugin-jobs` — stateful lifecycle derivation + a stat-cards/sparkline detail view (the read-only visual recipe).
```

- [ ] **Step 10: Full suite + typecheck, commit**

Run: `npm run typecheck && npm test` — PASS.
```bash
git add examples/plugin-jobs/sparkline.ts examples/plugin-jobs/ui.tsx ui/src/test/sparkline.test.ts ui/src/test/jobsPlugin.test.tsx docs/PLUGINS.md
git commit -m "feat(examples): plugin-jobs UI — stat cards + duration sparkline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `examples/demo-stack` — compose, images, generators, README

**Files:**
- Modify: `.gitignore` (anchor the config line)
- Create: `.dockerignore` (repo root), `examples/demo-stack/docker-compose.yml`, `examples/demo-stack/Dockerfile.logsafe`, `examples/demo-stack/logsafe.config.json`, `examples/demo-stack/generators/Dockerfile.generator`, `examples/demo-stack/generators/{gateway,worker,webapp}.mjs`, `examples/demo-stack/README.md`

**Interfaces:**
- Consumes: the repo's build scripts (`build:ui` → `plugins:sync`), `LOGSAFE_HOST`/`LOGSAFE_DB` envs, `POST /v1/log`, both example plugins.
- Produces: `docker compose up --build` from `examples/demo-stack/` serving the full demo at `http://localhost:4600`.

- [ ] **Step 1: Anchor the gitignore line**

In `.gitignore`, change the line `logsafe.config.json` to `/logsafe.config.json` (root-only). Verify: `git check-ignore examples/demo-stack/logsafe.config.json` must print NOTHING (exit 1), while `git check-ignore logsafe.config.json` still matches.

- [ ] **Step 2: Create the repo-root `.dockerignore`**

The logsafe image builds with the repo root as context — exclude host artifacts:
```
node_modules
**/node_modules
.git
.claude
.superpowers
packages/server/dist
packages/server/public
*.db
*.db-*
docs
design
```

- [ ] **Step 3: Demo config**

`examples/demo-stack/logsafe.config.json`:
```json
{ "plugins": ["./examples/plugin-http", "./examples/plugin-jobs"] }
```
Confirm it is trackable: `git status --short examples/demo-stack/` shows it as untracked (not ignored).

- [ ] **Step 4: logsafe image**

`examples/demo-stack/Dockerfile.logsafe`:
```dockerfile
# Build context = repo root (see docker-compose.yml). node:20-slim (glibc)
# so better-sqlite3 installs from prebuilds.
FROM node:20-slim
WORKDIR /app
COPY . .
COPY examples/demo-stack/logsafe.config.json /app/logsafe.config.json
RUN npm ci
# plugins:sync reads /app/logsafe.config.json and bakes both example plugins
# into the UI bundle; build:ui runs it first.
RUN npm run build:ui
ENV LOGSAFE_HOST=0.0.0.0 \
    LOGSAFE_DB=/data/logsafe.db \
    PORT=4600
EXPOSE 4600
HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:4600/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "packages/server/src/cli.ts"]
```

- [ ] **Step 5: Generator image + scripts**

`examples/demo-stack/generators/Dockerfile.generator`:
```dockerfile
FROM node:20-alpine
WORKDIR /gen
COPY *.mjs ./
# SCRIPT chosen per-service in docker-compose.yml
ARG SCRIPT
ENV SCRIPT=${SCRIPT}
CMD ["sh", "-c", "node ${SCRIPT}"]
```

`examples/demo-stack/generators/gateway.mjs`:
```js
// API-gateway traffic generator: http-typed request events + a paired
// generic log line sharing the same trace (cross-source trace filtering).
const URL = process.env.LOGSAFE_URL ?? 'http://logsafe:4600/v1/log'
const SESSION = { session_id: 'api-gateway', session_label: 'API gateway' }
const ROUTES = ['/api/products', '/api/cart', '/api/search', '/api/checkout', '/api/user']
let n = 0

const rand = (a) => a[Math.floor(Math.random() * a.length)]
function latency() {
  if (Math.random() < 0.08) return 1000 + Math.floor(Math.random() * 1500) // slow tail
  return 20 + Math.floor(Math.random() * 380)
}
function status() {
  const r = Math.random()
  return r < 0.8 ? 200 : r < 0.9 ? 404 : 500
}

async function post(events) {
  try {
    await fetch(URL, { method: 'POST', body: JSON.stringify(events) })
  } catch { /* logsafe not up yet — drop and keep looping */ }
}

async function tick() {
  const trace = `r-${++n}`
  const path = rand(ROUTES)
  const method = path === '/api/checkout' || path === '/api/cart' ? 'POST' : 'GET'
  const st = status(), lat = latency()
  await post([
    { ...SESSION, source: 'gateway', ns: `http:${path.split('/')[2]}`, trace,
      level: st >= 500 ? 'error' : 'info',
      msg: `${method} ${path} ${st} ${lat}ms`,
      ctx: { method, path, status: st, latency_ms: lat } },
    { ...SESSION, source: 'gateway', ns: 'app', trace, level: 'debug',
      msg: `handler ${path} completed`, ctx: { latency_ms: lat } },
  ])
  setTimeout(tick, 1000 + Math.random() * 2000)
}
console.log('[gateway] generating ->', URL)
tick()
```

`examples/demo-stack/generators/worker.mjs`:
```js
// Job-worker generator: job:* lifecycle events (start -> done|failed with
// duration), 4 job kinds, ~10% failures, occasional generic warn.
const URL = process.env.LOGSAFE_URL ?? 'http://logsafe:4600/v1/log'
const SESSION = { session_id: 'job-worker', session_label: 'Job worker' }
const KINDS = ['resize-image', 'send-email', 'sync-inventory', 'export-report']
let n = 0

async function post(events) {
  try { await fetch(URL, { method: 'POST', body: JSON.stringify(events) }) } catch {}
}

async function runJob() {
  const name = KINDS[Math.floor(Math.random() * KINDS.length)]
  const job_id = `${name}-${++n}`
  const duration = 100 + Math.floor(Math.random() * 2400)
  const fails = Math.random() < 0.1
  await post([{ ...SESSION, source: 'worker', ns: `job:${name}`, level: 'info',
    msg: `job start ${job_id}`, ctx: { job_id, name, event: 'start' } }])
  setTimeout(async () => {
    if (fails && Math.random() < 0.5) {
      await post([{ ...SESSION, source: 'worker', ns: 'app', level: 'warn',
        msg: `job ${job_id} retrying after transient error`, ctx: { job_id } }])
    }
    await post([{ ...SESSION, source: 'worker', ns: `job:${name}`,
      level: fails ? 'error' : 'info',
      msg: `job ${fails ? 'failed' : 'done'} ${job_id} in ${duration}ms`,
      ctx: { job_id, name, event: fails ? 'failed' : 'done', duration_ms: duration } }])
  }, duration)
  setTimeout(runJob, 2000 + Math.random() * 3000)
}
console.log('[worker] generating ->', URL)
runJob()
```

`examples/demo-stack/generators/webapp.mjs`:
```js
// Web-app generator: generic logs at every level across a few namespaces,
// a periodic error burst (minimap texture), and an occasional event with an
// explicit unowned type ("metrics") to demo the not-installed banner.
const URL = process.env.LOGSAFE_URL ?? 'http://logsafe:4600/v1/log'
const SESSION = { session_id: 'webapp', session_label: 'Web app' }
const NS = ['auth:login', 'auth:token', 'cart:add', 'cart:checkout', 'ui:render']
const LINES = ['user signed in', 'token refreshed', 'item added', 'render pass', 'cache miss', 'session persisted']

async function post(events) {
  try { await fetch(URL, { method: 'POST', body: JSON.stringify(events) }) } catch {}
}
const rand = (a) => a[Math.floor(Math.random() * a.length)]
function level() {
  const r = Math.random()
  return r < 0.3 ? 'debug' : r < 0.8 ? 'info' : r < 0.95 ? 'warn' : 'error'
}

async function tick() {
  await post([{ ...SESSION, source: 'webapp', ns: rand(NS), level: level(), msg: rand(LINES),
    ctx: { user: `u-${1 + Math.floor(Math.random() * 5)}` } }])
  setTimeout(tick, 500 + Math.random() * 1500)
}
async function burst() {
  await post(Array.from({ length: 6 }, (_, i) => ({
    ...SESSION, source: 'webapp', ns: 'cart:checkout', level: 'error',
    msg: `payment provider timeout (attempt ${i + 1})`, ctx: { attempt: i + 1 } })))
  setTimeout(burst, 25000 + Math.random() * 10000)
}
async function metrics() {
  await post([{ ...SESSION, source: 'webapp', ns: 'metrics', type: 'metrics', level: 'info',
    msg: 'web-vitals sample', ctx: { lcp_ms: 1800 + Math.floor(Math.random() * 800) } }])
  setTimeout(metrics, 20000)
}
console.log('[webapp] generating ->', URL)
tick(); setTimeout(burst, 10000); setTimeout(metrics, 5000)
```

- [ ] **Step 6: Compose file**

`examples/demo-stack/docker-compose.yml`:
```yaml
name: logsafe-demo

services:
  logsafe:
    build:
      context: ../..
      dockerfile: examples/demo-stack/Dockerfile.logsafe
    ports:
      - "127.0.0.1:4600:4600"
    volumes:
      - logsafe-data:/data

  gateway:
    build: { context: ./generators, dockerfile: Dockerfile.generator, args: { SCRIPT: gateway.mjs } }
    depends_on: { logsafe: { condition: service_healthy } }

  worker:
    build: { context: ./generators, dockerfile: Dockerfile.generator, args: { SCRIPT: worker.mjs } }
    depends_on: { logsafe: { condition: service_healthy } }

  webapp:
    build: { context: ./generators, dockerfile: Dockerfile.generator, args: { SCRIPT: webapp.mjs } }
    depends_on: { logsafe: { condition: service_healthy } }

volumes:
  logsafe-data:
```
> The generator Dockerfile bakes `SCRIPT` via build ARG→ENV; compose passes it per service. `ENV SCRIPT=${SCRIPT}` in the Dockerfile makes the ARG persist to runtime.

- [ ] **Step 7: README**

`examples/demo-stack/README.md` — sections: What this is (one paragraph); Run it (`docker compose up --build`, open http://localhost:4600); **The tour** (numbered, from spec §3.4: three row renderers in the list → gateway timeline + click-a-red-bar trace filter → job-worker stat cards + sparkline with red failure dots → webapp flat view, level filters, error bursts on the minimap, and the "metrics plugin not installed" banner → live tail everywhere); How it works (compose topology, one line per service, plugins baked at image build via `plugins:sync`); Cleanup (`docker compose down` — add `-v` to reset data).

- [ ] **Step 8: Verify (docker required)**

```bash
cd examples/demo-stack
docker compose config -q               # compose syntax valid
docker compose up --build -d           # first build takes a few minutes
sleep 25
curl -s localhost:4600/api/health      # {"ok":true}
curl -s localhost:4600/api/sessions | python3 -c "import json,sys; [print(s['id'], s['types']) for s in json.load(sys.stdin)]"
# expect: api-gateway ['generic','http'] · job-worker ['generic','job'] (+ after ~5s 'metrics' on webapp) · webapp ['generic','metrics']
curl -s localhost:4600/api/plugins/jobs/summary/job-worker
curl -s localhost:4600/api/plugins/http/summary/api-gateway
docker compose down
```
Expected: health ok; three sessions with the expected types; both plugin summaries return non-zero counts after ~30s of traffic. If docker is unavailable in the execution environment, run `docker compose config -q` only and mark the full acceptance as pending-manual in the report.

- [ ] **Step 9: Full suite + typecheck (unchanged code, still run once), commit**

```bash
git add .gitignore .dockerignore examples/demo-stack
git commit -m "feat(examples): docker demo-stack — containerized logsafe + three log generators

One-command showcase: gateway (http timeline), worker (jobs stat cards +
sparkline), webapp (generic levels + not-installed banner). Anchors the
logsafe.config.json gitignore to root so the demo config is committable.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npm run typecheck && npm test` — all green (plugin-jobs trio included).
- [ ] `ui/src/plugins.generated.ts` still the empty stub; root `logsafe.config.json` still ignored; `examples/demo-stack/logsafe.config.json` tracked.
- [ ] Docker acceptance from Task 3 Step 8 ran (or explicitly marked pending-manual).
- [ ] Push and open the new PR (base: main), body summarizing the two deliverables + demo tour, ending with the standard PR trailer.
