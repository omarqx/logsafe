# deblog Phase 4 (Web UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deblog SPA — Direction A "Phosphor" — as a Vite + React app in `ui/`, virtualized to 100k rows, with SSE live tail and URL-shareable filters, served from the server's `public/` dir, verified end-to-end against the demo session.

**Architecture:** The server's `API.md` is the FROZEN contract — the UI consumes it exactly, no server API changes (one exception: an SPA fallback for client-side routes, Task 7). Filters live in the URL (`URLSearchParams` is the single source of truth) and map 1:1 onto `/api/sessions/:id/events` query params. Events stream into an in-memory store: progressive page loads via `next_after_seq`, then SSE tail from the last seq. `@tanstack/react-virtual` renders the stream.

**Design source of truth:** `design/direction-a-session-detail.html` and `design/direction-a-session-list.html` — the approved Phosphor mockups. Port their CSS custom properties, spacing, and row anatomy faithfully. Fonts via `@fontsource` (bundled, works offline) — JetBrains Mono.

**Tech Stack:** Vite 6, React 18, TypeScript strict, react-router-dom 7, @tanstack/react-virtual, @fontsource/jetbrains-mono, vitest + @testing-library/react (pure-logic tests).

## Global Constraints

- The HTTP contract is `API.md` — frozen. The UI must not require any change to documented routes/params/shapes.
- URL is the source of truth for ALL view state that should be shareable: filters (`ns`, `level`, `source`, `trace`, `q`), timestamp mode (`ts=abs|rel|delta`), pinned rows (`pin=<seq>,<seq>`), selected row (`sel=<seq>`). Copying the address bar reproduces the view.
- Ordering/pagination: `seq ASC`, cursor `after_seq` (per API.md). Client sorts nothing; server order is display order.
- Virtualized stream must stay smooth at 100k rows: row components must be O(1) — no per-row array scans; ctx JSON stringified lazily on expand only.
- Phosphor tokens (from the mockup, verbatim): bg `#0a0d0b`, bg-raise `#0e1210`, txt `#b6c2b8`, dim `#5d6b60`, faint `#37423a`, line `#1a221c`, phos `#4af0a8`, amber `#ffb454`, err `#ff5c53`, cyan(webapp) `#5cc9f5`, violet(api) `#c792ea`. Row height 20px, grid columns `8px 74px 64px 150px 52px 1fr`, one mono face everywhere.
- Additional sources beyond webapp/api get colors from a fixed 6-hue cycle (cyan, violet, `#8fa3b8`, `#e0af68`, `#9ece6a`, `#f7768e`) assigned by first-appearance order — deterministic within a session.
- Level colors: debug=faint, info=dim (NO color), warn=amber, error=err. Semantic hues never used for sources; source hues never used for levels.
- Keyboard-first: `j/k` move selection, `Enter`/`o` toggle ctx expand, `/` focus search, `f` focus filter input, `e` toggle `level=warn,error` chip, `p` pin/unpin selected, `t` cycle timestamp mode, `g`/`G` top/bottom, `G` at bottom resumes tail, `Esc` blur inputs. Never intercept keys while an input is focused (except Esc).
- Dev: `npm run dev:ui` (Vite on 5173, proxying `/api` + `/v1` to 4600). Prod: `npm run build:ui` emits into `packages/server/public/` (gitignored); server serves it with SPA fallback.
- TypeScript strict, ESM. Commit after every task. Run commands from repo root.

## File Structure

```
ui/
  index.html
  package.json            (workspace member: ui)
  tsconfig.json
  vite.config.ts          (proxy /api,/v1 → 4600; outDir ../packages/server/public, emptyOutDir)
  src/
    main.tsx              (router setup: /  and /s/:id)
    theme.css             (Phosphor tokens + base styles, ported from mockups)
    api.ts                (typed contract client: SessionSummary, StoredEvent, listSessions, getSession, fetchEventsPage)
    lib/filters.ts        (Filters type ⇄ URLSearchParams, ⇄ events-API query string)  [PURE, TESTED]
    lib/time.ts           (formatTs abs/rel/delta, formatDuration)                     [PURE, TESTED]
    lib/minimap.ts        (binEvents: events → density bins + error marks)             [PURE, TESTED]
    lib/sources.ts        (source → color class assignment, 6-hue cycle)               [PURE, TESTED]
    hooks/useUrlState.ts  (read/write URLSearchParams via router)
    hooks/useEventStream.ts (progressive load + SSE tail + pause buffer + pins)        [TESTED]
    routes/SessionList.tsx
    routes/SessionDetail.tsx
    components/CmdBar.tsx     (filter chips + search + ts segmented control)
    components/LogRow.tsx     (memo; gutter/ts/src/ns/lvl/msg + ctx preview)
    components/CtxPanel.tsx   (expanded JSON, copy, filter-trace action)
    components/Minimap.tsx    (vertical right-edge strip, click-to-jump)
    components/PinnedStrip.tsx
    components/StatusBar.tsx  (counts, tail state, resume affordance)
    test/…                (vitest for lib/* and useEventStream)
packages/server/src/index.ts   (Task 7: SPA fallback)
packages/server/test/spa.test.ts
```

Root `package.json` gains: `"dev:ui": "vite --config ui/vite.config.ts"`, `"build:ui": "vite build --config ui/vite.config.ts"`, workspace `ui`, and `typecheck` extended with `tsc -p ui --noEmit`. `.gitignore` gains `packages/server/public/`.

---

### Task 1: UI scaffold + theme + shell

**Files:** `ui/package.json`, `ui/tsconfig.json`, `ui/vite.config.ts`, `ui/index.html`, `ui/src/main.tsx`, `ui/src/theme.css`, root `package.json` (scripts + workspace), `.gitignore`.

**Interfaces produced:** a booting app at `/` and `/s/:id` rendering placeholder routes inside a `.frame` shell with the Phosphor header (logo, blinking cursor); `theme.css` exposes every token from Global Constraints as CSS custom properties plus base row/chip/kbd classes ported from the mockups.

Steps: scaffold files; `npm install` workspace deps (react, react-dom, react-router-dom, @tanstack/react-virtual, @fontsource/jetbrains-mono; dev: vite, @vitejs/plugin-react, typescript, @testing-library/react, jsdom); verify `npm run dev:ui` boots and `npm run build:ui` emits `packages/server/public/index.html`; verify `npm run typecheck` passes with the new project included; commit `feat(ui): Vite+React scaffold with Phosphor theme shell`.

Vite config essentials:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: path.dirname(new URL(import.meta.url).pathname),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4600',
      '/v1': 'http://127.0.0.1:4600',
    },
  },
  build: {
    outDir: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../packages/server/public'),
    emptyOutDir: true,
  },
})
```

### Task 2: Contract client + pure logic modules (TDD)

**Files:** `ui/src/api.ts`, `ui/src/lib/filters.ts`, `ui/src/lib/time.ts`, `ui/src/lib/sources.ts`, `ui/src/lib/minimap.ts`, tests for each under `ui/src/test/`.

**Interfaces produced (later tasks depend on exact names):**

```ts
// api.ts — mirror API.md exactly
export interface SessionSummary { id: string; label: string | null; first_ts: number; last_ts: number;
  duration_ms: number; status: 'active' | 'idle'; event_count: number; error_count: number;
  warn_count: number; sources: string[] }
export interface StoredEvent { seq: number; session_id: string; ts: number; received_at: number;
  source: string; ns: string; level: 'debug'|'info'|'warn'|'error'; msg: string; ctx: unknown; trace: string | null }
export async function listSessions(): Promise<SessionSummary[]>
export async function getSession(id: string): Promise<SessionSummary | null>   // null on 404
export async function fetchEventsPage(id: string, params: URLSearchParams, afterSeq?: number, limit?: number):
  Promise<{ events: StoredEvent[]; next_after_seq: number | null }>

// lib/filters.ts — URL is source of truth
export interface Filters { ns?: string; level?: string; source?: string; trace?: string; q?: string }
export function filtersFromSearch(sp: URLSearchParams): Filters
export function filtersToSearch(f: Filters, base?: URLSearchParams): URLSearchParams  // preserves ts/pin/sel keys
export function filtersToApiParams(f: Filters): URLSearchParams                       // only API-known keys
export function toggleErrorLevel(f: Filters): Filters   // e key: level ⇄ 'warn,error'

// lib/time.ts
export type TsMode = 'abs' | 'rel' | 'delta'
export function formatTs(mode: TsMode, ev: { ts: number }, sessionStart: number, prevTs: number | null): string
// abs → 'HH:MM:SS.mmm' local; rel → '+SS.mmm' (minutes as '+MM:SS.mmm' past 60s); delta → '+0.012' vs prev, '' for first
export function formatDuration(ms: number): string      // '30s', '2m 04s', '6h 12m'

// lib/sources.ts
export function sourceColorIndex(sources: string[], source: string): number  // 0..5, first-appearance order
// 'webapp' and 'api' are pre-seeded to 0 and 1 whenever present, so demo data always matches the mockup

// lib/minimap.ts
export interface MinimapBin { top: number; height: number; intensity: number }   // percentages 0..100, 0..1
export interface MinimapMark { top: number }                                     // error position %
export function binEvents(events: { ts: number; level: string }[], binCount: number):
  { bins: MinimapBin[]; errors: MinimapMark[] }
```

TDD: write failing vitest suites first (URL round-trips incl. preservation of `ts`/`pin`/`sel` when filters change; api-params excludes non-API keys; formatTs all three modes incl. minute rollover and first-row delta; duration formatting; source pre-seeding; binEvents distributes by ts and marks errors). Then implement. `fetchEventsPage` tested against a mocked `fetch` verifying the exact query string built. Commit `feat(ui): contract client and pure view-logic modules`.

### Task 3: Session list route

**Files:** `ui/src/routes/SessionList.tsx`, wiring in `main.tsx`.

Port `design/direction-a-session-list.html` faithfully: column grid, status glyph (pulse for `active`), label + dim id, source tags (via `sourceColorIndex` hues), tabular-num counts, error count in err color when >0, warn count amber, duration via `formatDuration`, started time from `first_ts`. Data from `listSessions()` with a 5s refresh interval. Row click / `Enter` → `/s/:id`. `j/k` selection with `.selected` inset-bar styling, `x` → confirm() then `DELETE /api/sessions/:id` and refresh. Footer: totals + deblog version. Empty state: dim italic “no sessions yet — POST /v1/log to create one” with the curl one-liner. Manual verify against the live server (demo session visible). Commit `feat(ui): session list route`.

### Task 4: Event stream hook (TDD)

**Files:** `ui/src/hooks/useEventStream.ts`, `ui/src/test/useEventStream.test.ts` (+ tiny `hooks/useUrlState.ts`).

**Interface produced:**

```ts
export interface StreamState {
  events: StoredEvent[]          // filtered, seq ASC, append-only identity (stable refs for memo rows)
  loading: boolean               // initial page load in progress
  tail: 'live' | 'paused'
  pendingCount: number           // events buffered while paused
  pinned: StoredEvent[]          // resolved pin=seqs, independent of filters
  error: string | null
}
export interface StreamApi {
  pause(): void
  resume(): void                 // flushes pending into events
  refetch(): void                // filters changed → reset + reload
}
export function useEventStream(sessionId: string, apiParams: URLSearchParams, pinSeqs: number[]): [StreamState, StreamApi]
```

Behavior (test each with mocked fetch + a stub EventSource class):
1. **Progressive load:** page through `fetchEventsPage` with `limit=10000` following `next_after_seq` until null; events accumulate in order.
2. **Tail:** after load, open `EventSource('/api/sessions/:id/stream?after_seq=<last>')`; parse `event: log` frames; matching events (client applies the SAME filter predicate — reimplement ns-wildcard prefix match, level list, source list, trace, q substring over msg+ctx — so tail respects filters without refetching) append when `tail==='live'`, buffer into pending when `'paused'`; non-matching events are dropped but still advance the resume cursor.
3. **Pause/resume:** `pause()` starts buffering; `resume()` appends buffered and clears count.
4. **Filter change:** `refetch()` tears down the EventSource, clears state, reloads (SSE `after_seq` restart from new last seq).
5. **Pins:** for any `pinSeqs` not present in `events`, fetch each via `after_seq=seq-1&limit=1` (documented API trick); `pinned` sorted by seq.
6. **SSE error → reconnect with last seq after 1s; `error` set only if the initial load fails.**

Commit `feat(ui): event stream hook — progressive load, filtered SSE tail, pins`.

### Task 5: Session detail route — stream, rows, ctx, cmd bar

**Files:** `ui/src/routes/SessionDetail.tsx`, `ui/src/components/{CmdBar,LogRow,CtxPanel,PinnedStrip,StatusBar}.tsx`.

Port `design/direction-a-session-detail.html` faithfully. Composition:
- **Header:** crumb (label, id), counts (events/errors dim-red/warns amber/sources+duration), tail state chip.
- **CmdBar:** `❯` prompt; active filters as removable chips (`ns:…`, `level:…` in err-tint when it includes error, `trace:…`, free-text); an inline text input that parses `key:value` tokens into filter chips on Enter (bare text → `q`); ts-mode segmented control (`abs|rel|Δ`); kbd hints. All mutations write through `useUrlState` → URL → `filtersFromSearch` → `refetch()`.
- **Stream:** `@tanstack/react-virtual` fixed-size rows (20px) over `state.events`; overscan 40. `LogRow` is `React.memo` receiving only primitives + the event ref: gutter color by `sourceColorIndex`, ts via `formatTs` (mode from URL), dim ns, level styling per constraints, msg with inline dim ctx preview (`JSON.stringify` truncated to 120 chars, computed lazily and cached on the event object), trace marker `⌁` (click → sets `trace` filter). Selected row: `sel=<seq>` in URL, inset phosphor bar.
- **CtxPanel:** expanding a row (Enter/o/click caret) renders the panel under it (react-virtual `measureElement` dynamic size): pretty-printed ctx with key/string/number token colors, actions row (`copy json` → clipboard; `filter trace`; seq + received_at metadata).
- **PinnedStrip:** pinned events above the stream, same row anatomy + `⌖`, always visible regardless of filters; `p` toggles selected row's seq in `pin=` URL param.
- **StatusBar:** shown/total counts, tail state (`⏸ live tail paused — G to resume` amber when paused), API latency of last fetch.

Scroll behavior: stick-to-bottom when tail is live; any upward scroll → `pause()`; `G` (or clicking the paused banner) scrolls to end + `resume()`.

Manual verify against demo session with several filter permutations (URL round-trip: paste copied URL into a new tab reproduces view). Commit `feat(ui): session detail — virtualized phosphor stream`.

### Task 6: Minimap + keyboard layer

**Files:** `ui/src/components/Minimap.tsx`, `ui/src/hooks/useKeyboard.ts`, integration in SessionDetail.

- **Minimap:** vertical right-edge strip (30px) per mockup: density bins from `binEvents(events, 60)`, error marks (glow), viewport indicator derived from virtualizer scroll offset/height; click (or drag) → scroll to the proportional event index; live tail keeps indicator pinned to bottom.
- **Keyboard:** one document-level handler implementing the Global Constraints map; selection follows virtualizer (j/k scroll selected row into view); typing guard (`e.target` input/textarea → only Esc). Footer kbd hints match actual bindings.

Vitest for the pure parts already covered (binEvents in Task 2); manual verify keyboard flows. Commit `feat(ui): minimap and keyboard-first navigation`.

### Task 7: Server SPA fallback + build integration

**Files:** `packages/server/src/index.ts` (modify), `packages/server/test/spa.test.ts`.

- After `@fastify/static` registration (only when `public/` exists): `app.setNotFoundHandler` that serves `public/index.html` for `GET` requests whose path does not start with `/api` or `/v1` (client-side routes like `/s/:id` must deep-link); API 404s must remain JSON (`/api/sessions/nope` still 404 JSON — regression-test it).
- TDD with a temp public dir fixture: `GET /s/whatever` → 200 html; `GET /api/sessions/nope` → 404 json; no public dir → default 404.
- `npm run build:ui && npm start` smoke: `curl localhost:4600/` returns the app html; `curl localhost:4600/s/x` returns html; API still works.
- Commit `feat(server): SPA fallback for client routes`.

### Task 8: End-to-end verification + docs

**Files:** `README.md` (Web UI section), fixes as found.

1. `npm run build:ui`, start server, drive the real browser (preview tools) through: session list shows demo session with 4 errors → open detail → error rows visible and styled → apply `ns=payment.*` filter via chip input → URL updates → paste URL fresh → same view → expand error ctx → pin a row → change filters → pin survives → minimap click jumps.
2. Live tail: run a script emitting one event/second to the demo session (tsx one-liner using @deblog/client); verify rows appear live; scroll up → paused banner + pending count; `G` → resumes.
3. Scale check: generate a 100k-event session (script: batches of 1000 via raw POST, mixed sources/levels), open it, confirm smooth scroll and sane minimap.
4. Screenshot both screens as proof; fix everything found (each fix committed).
4. README: add "Web UI" section (`npm run build:ui && npm start` → http://127.0.0.1:4600, keyboard map table, shareable-URL note). Commit `docs: web UI section`.

## Phase 4 exit criteria

1. `npm test` green (server + ui suites), `npm run typecheck` clean (3 projects).
2. `npm run build:ui && npm start` serves the app at 4600 with deep links working.
3. The Task 8 browser walkthrough passes with screenshots.
4. Virtualization sanity: a generated 100k-event session (script: 100k events via client in batches) scrolls smoothly and minimap renders without jank.
