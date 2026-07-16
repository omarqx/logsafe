# `plugin-jobs` (stat cards + sparkline) + Docker demo stack — design

> **Status:** approved design (brainstormed 2026-07-16). Builds on the plugin
> system (PR #2: SDK, `plugin-hello`, `plugin-http` timeline, starter template,
> PLUGINS.md).
>
> Decisions locked with the author:
> - **Option B visual** (stat cards + latency/duration sparkline, from the
>   2026-07-15 mockups) ships as a **new example plugin `plugin-jobs`** owning
>   a background-worker domain — giving three coexisting plugins.
> - **Docker demo**: a fully self-contained `examples/demo-stack/` in the
>   logsafe repo — containerized logsafe + three tiny generator services.
> - **Delivery: a NEW PR after PR #2 merges** (branch from the merged main).

---

## 1. Goals and non-goals

**Goals.**
1. A second custom-visual example (`examples/plugin-jobs`): Option B — stat
   cards + an SVG sparkline — demonstrating a **stateful** derivation
   (job lifecycle start→done/failed), complementing plugin-http's stateless
   one.
2. A one-command demo (`docker compose up` in `examples/demo-stack/`) that
   exercises every visible plugin-system feature at once: three row
   renderers in one session list, two custom detail visuals, matcher
   classification + transform, derived tables + plugin routes, trace
   filtering, all four log levels, and the plugin-not-installed banner.

**Non-goals.** Live SSE inside plugin views (5s polls stay); shared time
axis (issue #6); CI for docker builds (manual acceptance, like the
voting-app demo); touching example-voting-app; publishing images.

---

## 2. `examples/plugin-jobs`

### 2.1 Manifest

```jsonc
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

Priority 4 — below http (5) and hello (10); the three never share a type, so
priority only makes registry ordering deterministic.

### 2.2 Event convention (what the worker generator emits)

`ns: "job"` or `"job:<name>"`; `ctx`:

| field | on `start` | on `done` / `failed` |
|---|---|---|
| `job_id` | required (unique per run) | required (same id) |
| `name` | required | optional (kept from start) |
| `event` | `"start"` | `"done"` or `"failed"` |
| `duration_ms` | — | required |

### 2.3 Server (`server.ts`)

- `matchType`: `ns === 'job' || ns.startsWith('job:')` → `'job'`.
- No `transform` (deliberate: shows a plugin can skip hooks; http covers it).
- `migrate`: `plugin_jobs_runs` via `ctx.db.table('runs')`:

  ```sql
  CREATE TABLE IF NOT EXISTS plugin_jobs_runs (
    session_id  TEXT NOT NULL,
    job_id      TEXT NOT NULL,
    name        TEXT,
    status      TEXT NOT NULL,        -- 'running' | 'done' | 'failed'
    duration_ms INTEGER,              -- null while running
    ts          INTEGER NOT NULL,     -- last lifecycle event's ts
    PRIMARY KEY (session_id, job_id)
  )
  ```

- `afterInsert` (the stateful part; events may span sessions — group not
  required, upsert is keyed): for each owned event with a valid `ctx.job_id`
  and `ctx.event`:
  - `start` → INSERT `('running', NULL)`; ON CONFLICT keep existing final
    status (a late/replayed start must not resurrect a finished run) but
    fill a NULL `name`.
  - `done`/`failed` → INSERT-or-UPDATE to final status + `duration_ms` + `ts`
    (out-of-order safe: a final event with no prior start still creates the
    row).
  Events without `job_id`/`event` are ignored (flat log only).
- `routes`:
  - `GET /summary/:sessionId` → `{ processed, running, failed,
    failure_rate_pct, avg_duration_ms, max_duration_ms }` (`processed` =
    done+failed; rates/avgs over completed runs only; zeros when none).
  - `GET /durations/:sessionId` → `{ runs: JobRun[] }` — completed runs,
    `ts ASC` (sparkline data). `JobRun = { session_id, job_id, name, status,
    duration_ms, ts }`.
- `onSessionDelete`: delete the session's rows.

### 2.4 UI (`ui.tsx` + `sparkline.ts`) — the Option B visual

- **`sparkline.ts`** (pure, no React/DOM, unit-tested — same pattern as
  `timeline.ts`): `layoutSparkline(runs, {width, height}): SparklinePoint[]`
  mapping ts→x across the span (single-point /0-safe) and duration→y
  (0 at baseline, max duration at top, min-height clamp); caps at the most
  recent `MAX_SPARKLINE_POINTS = 120` runs; `pointColor(run, tokens)` —
  `failed` → `tokens.err`, `duration_ms > 1000` → `tokens.amber`, else
  `tokens.phos`.
- **`JobsListRow`**: default-row layout + badge
  `⚙ jobs · N done · X% fail · avg Yms` from `pluginFetch('/summary/...')`.
- **`JobsDetailView`** (top to bottom):
  1. Four stat cards (bordered boxes per the mockup, `tokens` colors):
     `PROCESSED` · `FAILED %` (err color when > 0) · `AVG DUR` · `MAX DUR`
     (amber when > 1000ms).
  2. The sparkline: one `<polyline>` through completed-run points
     (`tokens.phos`, 1.5px) + a `<circle>` marker per failed/slow run with
     its color from `pointColor`; a baseline `tokens.line` rule. Height ~60px,
     full width. `role="img"` + `<title>`.
  3. `<FlatLogView sessionId session />`.
  Data from `/summary` + `/durations`, polled at `SUMMARY_POLL_MS = 5000`
  with cancelled-flag cleanup (same `useHttpData` shape; plugin-local copy —
  examples stay dependency-free of each other).
- No urlState interaction in this example (the timeline already teaches it);
  the sparkline is read-only.

### 2.5 Tests (mirror plugin-http's trio)

- `packages/server/test/plugin-jobs.test.ts` — static import + hand-built
  `LoadedServerPlugin`; POST lifecycle batches through `app.inject`; assert:
  start→running, done→final with duration, failed counted, late-start does
  not resurrect a finished run, out-of-order final creates the row,
  `/summary` numbers, `/durations` ordering/completed-only, cleanup on
  session delete.
- `ui/src/test/sparkline.test.ts` — geometry: x across span, y scaling +
  clamp, single-point safety, 120-cap keeping newest, `pointColor` buckets.
- `ui/src/test/jobsPlugin.test.tsx` — contract + `resolveViewOwner`; render
  DetailView with stubbed runtime/pluginFetch: 4 stat cards with computed
  values, polyline present, one marker per failed run, `FLAT-LOG-STUB`
  composed.

---

## 3. `examples/demo-stack`

### 3.1 Files

```
examples/demo-stack/
  docker-compose.yml
  Dockerfile.logsafe        # repo-root build context
  logsafe.config.json       # { "plugins": ["./examples/plugin-http", "./examples/plugin-jobs"] }
  generators/
    Dockerfile.generator    # node:20-alpine + one script (arg)
    gateway.mjs
    worker.mjs
    webapp.mjs
  README.md
```

### 3.2 The logsafe container

`Dockerfile.logsafe` (build context = repo root, `node:20-slim` so
better-sqlite3 prebuilds work):
1. COPY repo, `npm ci`.
2. COPY `examples/demo-stack/logsafe.config.json` → `/app/logsafe.config.json`
   (workdir root, where both `readPluginConfig` and `plugins-sync` look).
3. `npm run build:ui` (runs `plugins:sync` first → registry contains http +
   jobs; Vite bundle lands in `packages/server/public`).
4. `EXPOSE 4600`; `CMD npx tsx packages/server/src/cli.ts` with
   `LOGSAFE_HOST=0.0.0.0` (container-internal bind; compose maps
   `127.0.0.1:4600:4600` so the host exposure stays loopback),
   `LOGSAFE_DB=/data/logsafe.db` (anonymous volume).

**Codegen caveat handled:** `plugins-sync` resolves relative specifiers and
emits absolute paths — inside the image those are `/app/examples/...`, valid
at build time, baked into the bundle. Fine, because the UI build happens in
the same layer.

### 3.3 Generators — "several levels of code"

One tiny dependency-free `.mjs` per service (Node 20 global `fetch`,
`setTimeout` loops, jittered):

| service | session (`session_id` / label) | emits |
|---|---|---|
| `gateway.mjs` | `api-gateway` / "API gateway" | every 1–3s: an `http`/`http:<route>` request event (`ctx: {method, path, status, latency_ms}`; weighted ~80% 2xx / 10% 4xx / 10% 5xx; latencies mostly 20–400ms, ~8% > 1000ms) with `trace: r-<n>`, plus a generic `ns:'app'` log line sharing the same trace (cross-source trace filtering) |
| `worker.mjs` | `job-worker` / "Job worker" | every 2–5s: a full lifecycle — `job:start` then, after the job's simulated duration (100–2500ms), `job:done` (90%) or `job:failed` (10%) with `duration_ms`; 4 named job kinds; occasional generic `warn` retry lines |
| `webapp.mjs` | `webapp` / "Web app" | a steady mix of generic logs across `debug`/`info`/`warn`/`error` and ns `auth:*`, `cart:*`, `ui:*`; every ~30s a small burst of errors (minimap texture); every ~20s ONE event with explicit `type: "metrics"` (no plugin owns it → not-installed banner) |

All POST batches to `http://logsafe:4600/v1/log`, retry-forever with backoff
until logsafe is up (compose `depends_on` + healthcheck on `/api/health`
keeps startup clean anyway). `LOGSAFE_URL` env overridable.

### 3.4 What the demo shows (README's tour)

1. **Session list** — three renderers at once: ⚡ http badge row
   (`api-gateway`), ⚙ jobs badge row (`job-worker`), default row (`webapp`).
2. `api-gateway` detail — request **timeline**; click a red bar → trace
   filter; the paired generic log line from the same trace appears too.
3. `job-worker` detail — **stat cards + sparkline**, failures as red dots.
4. `webapp` detail — flat view, level filters, error bursts on the minimap,
   and the **"metrics plugin not installed"** banner.
5. Live tail everywhere (generators never stop).

### 3.5 Supporting change: anchor the gitignore

`.gitignore`'s `logsafe.config.json` line (added 2026-07-16) is unanchored
and would ignore `examples/demo-stack/logsafe.config.json`. Change it to
`/logsafe.config.json` (root-only). The demo-stack config MUST be committed.

---

## 4. Testing & acceptance

- **CI:** the plugin-jobs trio (§2.5) joins `npm test`; typecheck covers the
  new example via the test imports. Demo-stack has no CI (docker not
  assumed).
- **Manual acceptance:** `cd examples/demo-stack && docker compose up
  --build`; open `http://localhost:4600`; walk §3.4's tour. Also verify
  `docker compose down` + `up` resumes cleanly (volume persists; sessions
  continue).

## 5. Out of scope / follow-ups

- Publishing demo images; CI docker builds.
- SSE-driven plugin views; shared time axis (issue #6).
- A mixed-type single session demo (ownership tie-break) — the three-session
  layout is deliberately unambiguous.
