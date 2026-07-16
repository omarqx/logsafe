# HTTP example plugin + plugin-author templates — design

> **Status:** approved design (brainstormed 2026-07-15). Builds on the plugin
> system in `2026-07-14-plugin-system-design.md` (PR #2). Delivered onto the
> same PR branch.
>
> Decisions locked with the author:
> - **Example domain:** HTTP requests (`plugin-http`) — full-contract showcase.
> - **Detail visual:** **Option A — request timeline** (per-request latency
>   bars on a time axis, status-colored, click-a-bar → trace filter). Chosen
>   over stat-cards/sparkline as the truer rehearsal for the future video/QoE
>   plugin.
> - **Templates:** copyable starter package + `docs/PLUGINS.md` authoring
>   guide (no CLI scaffolder — YAGNI).
> - **Delivery:** added to PR #2.

---

## 1. Goals and non-goals

**Goals.**
1. A second, richer example plugin (`examples/plugin-http`) that exercises the
   **entire** contract the minimal `plugin-hello` skips: `transform`,
   `migrate`, `afterInsert`, `routes`, `onSessionDelete`, a data-fetching
   `ListRow`, and a `DetailView` with a **real custom visual** composing
   `FlatLogView`.
2. A copyable starter (`templates/plugin-starter`) a plugin author clones to
   get a compiling plugin in minutes.
3. An authoring guide (`docs/PLUGINS.md`) with focused recipes for custom UI.

**Non-goals.** The video/QoE plugin itself; a CLI scaffolder; chart-library
integration (the visual is plain SVG); shared-time-axis coordination between
the timeline and the composed flat log (issue #6 — the click→trace-filter
interaction here is deliberately simpler and needs no new core seam).

---

## 2. `examples/plugin-http` — full-contract example

### 2.1 Manifest (`package.json`)

```jsonc
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

Priority 5 (hello uses 10) — a session carrying both types opens hello, which
is fine; they don't overlap in practice.

### 2.2 Server (`server.ts`)

- **`matchType`** — claims events where `ns === 'http'` or
  `ns.startsWith('http:')` → `'http'`. Matches what `examples/demo.ts` and the
  voting app already emit.
- **`transform`** — if `ctx.latency_ms > 1000`, returns a patched event with
  `ctx.slow = true`. Small, but demonstrates the parse→mutate→re-store round
  trip end to end.
- **`migrate`** — one table via `ctx.db.table('requests')` →
  `plugin_http_requests`:

  ```sql
  CREATE TABLE IF NOT EXISTS plugin_http_requests (
    session_id TEXT NOT NULL,
    trace      TEXT NOT NULL,
    method     TEXT,
    path       TEXT,
    status     INTEGER,
    latency_ms INTEGER,
    ts         INTEGER NOT NULL,
    PRIMARY KEY (session_id, trace)
  )
  ```

  No stats rollup table — aggregates are computed by SQL in the routes
  (YAGNI; also demonstrates that derived tables don't have to mirror every
  query shape).
- **`afterInsert`** — for each claimed event whose `ctx` carries request
  fields (`method`/`path`/`status`/`latency_ms`), upsert into the table keyed
  by `(session_id, trace ?? String(seq))`. Events without those fields are
  ignored (they still show in the flat log).
- **`routes`** —
  - `GET /summary/:sessionId` → `{ request_count, error_count,
    avg_latency_ms, max_latency_ms }` (single aggregate query; `error_count`
    counts `status >= 500`).
  - `GET /requests/:sessionId` → `{ requests: Row[] }` ordered by `ts ASC`.
- **`onSessionDelete`** — `DELETE FROM plugin_http_requests WHERE session_id = ?`.

### 2.3 UI (`ui.tsx`)

- **`HttpListRow`** — default-row layout plus a phosphor badge: `⚡ http ·
  N reqs · X% err · avg Yms`, fetched once on mount via
  `pluginFetch('/summary/' + session.id)`. One fetch per http-typed row;
  acceptable at the list's 50-row cap (documented caveat in PLUGINS.md).
- **`HttpDetailView`** — three stacked parts:
  1. A one-line summary strip (same numbers as the badge, from `/summary`).
  2. **The request timeline (Option A visual).** Plain SVG, no chart
     library, themed via the SDK `tokens` prop:
     - x-axis = time from the first request's `ts` to the last's;
     - one row per request: label `METHOD path`, a bar positioned at its
       `ts` offset with width ∝ `latency_ms` (min 2px), colored `tokens.phos`
       (2xx/3xx), `tokens.amber` (`ctx.slow`/4xx), `tokens.err` (5xx);
       latency + status text after the bar;
     - **click a bar → trace filter**: sets `?trace=<trace>` through the
       `urlState` prop, which the composed `FlatLogView` below already reads —
       plugin↔core interaction with zero new contract surface;
     - rows capped at 40 (newest wins) with a “showing latest 40 of N” note —
       no virtualization in an example.
  3. `<FlatLogView sessionId={sessionId} session={session} />` composed
     beneath (unfiltered, so the whole mixed session stays visible).
  Data fetched once per mount + refreshed on a 5s interval (matching the
  session-poll cadence elsewhere); no SSE subscription in the example — the
  guide points at `useSessionEvents` for plugins that want live updates.

### 2.4 Tests

- **Server** (`packages/server/test/plugin-http.test.ts`): load via
  `loadServerPlugins(db, ['<repo>/examples/plugin-http'], …)`, POST a batch of
  `ns:'http'` events (mixed statuses/latencies, one slow), then assert:
  table rows upserted (dedup by trace), `/summary` aggregates correct,
  `/requests` ordered, `transform` set `ctx.slow`, DELETE session clears rows.
- **UI** (`ui/src/test/httpPlugin.test.tsx`, jsdom): contract conformance
  (`type === 'http'`, `resolveViewOwner` picks it); render `HttpDetailView`
  with stubbed `pluginFetch`/fetch and assert the timeline renders one bar per
  request and that clicking a bar writes `trace=` into `urlState.setParams`.

---

## 3. `templates/plugin-starter` — copyable starter

A minimal, compiling package with TODO markers (unchanged from the earlier
section of this design; the timeline lives only in the http example — the
starter's `DetailView` stays a banner + composed `FlatLogView`, the smallest
useful shape):

```
templates/plugin-starter/
  package.json   # manifest with id "my-plugin" + TODOs
  server.ts      # matchType stub; optional hooks present but commented
  ui.tsx         # ListRow + DetailView (banner + <FlatLogView/>)
  README.md      # 5 steps: copy → rename id → edit matcher →
                 #   add to logsafe.config.json → logsafe build + restart
```

One type-conformance test in the main suite (`ui/src/test/starterTemplate.test.tsx`)
imports the starter's ui entry so SDK drift breaks CI, mirroring
`helloPlugin.test.tsx`.

---

## 4. `docs/PLUGINS.md` — authoring guide

Recipe-oriented; linked from `README.md`. Sections:

1. **Anatomy** — manifest field table (id/apiVersion/ownedTypes/priority/
   server/ui), package layout, install flow (`logsafe.config.json` →
   `plugins:sync` → `build:ui` → restart), fallback behavior when a plugin
   isn't installed.
2. **Server hooks** — when-to-use per hook, the `plugin_<id>_*` table rule,
   "keep `afterInsert` fast" (link issue #5), cleanup contract.
3. **UI recipes** (each a short code block against the SDK):
   - custom list row (+ the grid-alignment caveat from design §7.4, and the
     per-row-fetch caveat);
   - custom detail view + composing `FlatLogView` with `baseFilters`;
   - **drawing a custom visual** — the http timeline distilled: SVG + `tokens`,
     no chart dependency, driving `urlState` for cross-component interaction;
   - live events via `useSessionEvents`;
   - `pluginFetch` ↔ `routes()` pairing;
   - theming with `tokens` / CSS vars.
4. **Worked examples** — pointers: `plugin-hello` (minimal), `plugin-http`
   (full contract + visual), `templates/plugin-starter` (start here).

---

## 5. Testing & acceptance

- `npm test` + `npm run typecheck` stay green; new tests as in §2.4/§3.
- Manual acceptance mirrors the voting-app demo: enable `plugin-http` in
  `logsafe.config.json`, rebuild, drive the voting app (its `ns` values are
  not `http:*`, so also POST a few `ns:'http'` request events), and verify the
  ⚡ badge in the list and the timeline-over-flat-log detail view.

## 6. Out of scope / follow-ups

- Shared time axis between timeline and flat log (issue #6).
- Async `afterInsert` (issue #5) — the example's per-batch work is trivial.
- SDK compiled dist (issue #3) — in-repo examples/templates consume source.
- Runtime UI drop-in (issue #4).
