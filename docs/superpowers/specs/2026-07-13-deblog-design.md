# deblog — Design Spec

**Date:** 2026-07-13
**Status:** Approved (Phase 1 brainstorm + consolidated design signed off)

## 1. Purpose

A generic, reusable local debugging log server. Applications emit structured
logs over HTTP to a single local process; the server persists them as sessions
in SQLite and serves a web UI for reading, filtering, and revisiting them.
Sessions must also be trivially readable by AI coding agents (plain HTTP query
API + NDJSON export).

The HTTP contract is the real API — anything that can send HTTP can log. The
TypeScript client helper is a convenience, not a requirement.

### Out of scope

- Domain-specific visualization (no charts, metrics, video/telemetry views)
- CDP / browser-devtools integration
- Multi-user, auth, cloud, packaging for distribution

## 2. Architecture

One npm-workspaces monorepo at `~/sandbox/deblog`:

```
deblog/
  packages/
    server/          # Fastify app, SQLite storage, serves UI build from public/
    client/          # @deblog/client — TS helper package
  examples/
    demo.ts          # fake webapp+api session generator (doubles as e2e smoke test)
  ui/                # Vite + React SPA (Phase 4), builds into server public/
  API.md             # frozen HTTP contract (written in Phase 2)
  docs/superpowers/specs/
```

- **Runtime:** single Node process, TypeScript throughout.
- **Framework:** Fastify — built-in JSON-schema validation for the ingest
  contract, first-class TypeScript, static file serving, raw response access
  for SSE.
- **Storage:** better-sqlite3, WAL mode. Synchronous by design: one batch =
  one prepared-statement transaction (~100k inserts/sec class); no queue.
- **Testing:** vitest.
- **Startup:** one command (`npm start`), binds `127.0.0.1:4600`, zero config
  required. Env overrides: `PORT` (4600), `DEBLOG_DB` (`~/.deblog/deblog.db`),
  `RETENTION_DAYS` (7).

## 3. Data model

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,      -- client-generated
  label       TEXT,                  -- last non-empty session_label wins
  first_ts    INTEGER NOT NULL,      -- epoch ms
  last_ts     INTEGER NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warn_count  INTEGER NOT NULL DEFAULT 0,
  sources     TEXT NOT NULL DEFAULT '[]'   -- JSON array of distinct sources
);

CREATE TABLE events (
  seq         INTEGER PRIMARY KEY,   -- rowid = server arrival order; pagination/SSE cursor
  session_id  TEXT NOT NULL,
  ts          INTEGER NOT NULL,      -- client time, epoch ms (server fills if absent)
  received_at INTEGER NOT NULL,      -- server arrival time, epoch ms
  source      TEXT NOT NULL DEFAULT 'default',
  ns          TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL,         -- debug | info | warn | error (coerced, never rejected)
  msg         TEXT NOT NULL,
  ctx         TEXT,                  -- JSON string, NULL if absent
  trace       TEXT                   -- optional free-form correlation id
);

CREATE INDEX idx_events_session_ns    ON events(session_id, ns);
CREATE INDEX idx_events_session_level ON events(session_id, level);
CREATE INDEX idx_events_session_ts    ON events(session_id, ts);
```

Design decisions:

- **Sessions are implicit.** A session springs into existence on its first
  event (upsert). There is no "end": status is computed at query time —
  `active` if `last_ts` is within 60s of now, else `idle`. Duration =
  `last_ts - first_ts`. Orphaned sessions are therefore a non-concept.
- **Denormalized counters.** `event_count`, `error_count`, `warn_count`,
  `sources`, `first_ts`, `last_ts` are maintained on the sessions row inside
  the same insert transaction. The session list never aggregates over
  `events`.
- **Server-assigned `seq`.** Client timestamps across sources skew and
  collide; `seq` (SQLite rowid) records arrival order and serves as the
  stable cursor for pagination and SSE resume. **The API's canonical order
  is `seq ASC`** — pagination cursors must match sort order, or pages can
  skip/duplicate events when client clocks skew. Sorting by `ts` (with `seq`
  tiebreak) is a display-level concern consumers apply within loaded data.
- **Labels.** Any event may carry an optional `session_label`; the server
  writes it to the session row (last non-empty write wins). Display fallback:
  first source + start time.

## 4. HTTP contract

To be frozen verbatim into `API.md` in Phase 2; the UI is built strictly
against `API.md`. Summary:

### Ingest — `POST /v1/log`

- Body: one event object **or** a JSON array of event objects.
- Event shape: `{ ts?, session_id?, source?, ns?, level?, msg, ctx?, trace?, session_label? }`
- **Only `msg` is required.** Defaults/coercions:
  - missing `session_id` → per-day scratch session `scratch-YYYY-MM-DD`
  - missing `source` → `"default"`; missing `ns` → `""`; missing `level` → `"info"`
  - unknown `level` → coerced to `"info"`, original preserved at `ctx._level`
  - `ts` accepts epoch-ms number or ISO 8601 string; missing → server time
- Response: `202 {"accepted": n}`; in array batches, unsalvageable events are
  skipped and counted: `{"accepted": n, "rejected": m}`. Only malformed JSON
  or a missing `msg` rejects an individual event; a bad event never fails the
  batch.
- Limits: 5 MB body, 1000 events per batch → `413`.
- **Permissive CORS** on all routes (safe: server binds loopback only;
  required: the browser helper POSTs from arbitrary `localhost:*` origins).
- Minimal curl: `curl localhost:4600/v1/log -d '{"msg":"here"}'`

### Query

- `GET /api/sessions?limit=&offset=` — newest first; each row includes
  computed `status` and `duration_ms` plus stored counters and sources.
- `GET /api/sessions/:id` — single session, same shape.
- `GET /api/sessions/:id/events` — filters, AND-composed across parameters:
  - `ns=auth:*,player.*` — comma-separated patterns, OR within the list.
    Patterns translate to SQLite `GLOB`; prefix patterns (`auth:*`) use the
    `(session_id, ns)` index — the documented fast path. Arbitrary patterns
    (`*.buffer`) work via in-session scan (≤100k rows: milliseconds).
  - `level=warn,error` — comma-separated, OR within the list
  - `source=webapp,api` — comma-separated, OR within the list
  - `trace=<id>` — exact match
  - `q=<substring>` — case-insensitive LIKE over `msg` and `ctx` (no FTS5;
    per-session scale doesn't justify it)
  - `from_ts=` / `to_ts=` — epoch ms range on `ts`
  - `after_seq=` / `before_seq=` — pagination cursor
  - `limit=` — default 500, max 10000
  - Response: `{ "events": [...], "next_after_seq": n | null }`, ordered
    `seq ASC` (matches the cursor; see §3)
- `GET /api/sessions/:id/export.ndjson` — one event JSON per line, full
  session by default, accepts the same filters.
- `DELETE /api/sessions/:id` — session row + events.
- `GET /api/health` — liveness.

### Live tail — `GET /api/sessions/:id/stream?after_seq=N` (SSE)

- Replays all events after `after_seq`, then streams live.
- Frames: `event: log` + `data: <event JSON>` (includes `seq`).
- Comment heartbeat every 15s. Client reconnects with last seen `seq` for
  lossless resume.
- Stream fan-out is independent of ingest; a slow consumer cannot block
  writes. Connections cleaned up on close.

## 5. Client helper — `@deblog/client`

```ts
import { initDeblog, createLog } from '@deblog/client'

initDeblog({ source: 'webapp', sessionId?, sessionLabel?, url?, enabled? })

const log = createLog('auth:token')
log.debug('validating', { userId })     // .info / .warn / .error
const rlog = log.withTrace(requestId)   // bound copy; sets trace on every event
```

- **No-op until `initDeblog` runs**, and when `enabled: false`. The disabled
  path is a single boolean check before any allocation — near-zero cost.
- **Batching:** flush every 250 ms or at 64 buffered events, whichever first.
- **Browser:** normal flushes via `fetch`; on `pagehide` and
  `visibilitychange → hidden`, flush via `navigator.sendBeacon` (survives
  page teardown; truncate to beacon quota if needed). `unload`/`beforeunload`
  are not relied on.
- **Node:** global fetch (Node 18+); flush on `beforeExit`.
- **Backpressure / failure policy:** fire-and-forget. Bounded in-memory
  buffer (10k events), drop-oldest when full; on recovery, emit one synthetic
  `warn` (`ns: "deblog"`) reporting the drop count. Network errors are
  swallowed after a single `console.warn`. The helper must never block,
  throw into, or slow the host app.
- Session id auto-generated if not supplied: compact ULID-style
  (time-sortable, no dependency). Zero runtime dependencies overall.

## 6. Retention

- At startup and hourly: delete whole sessions whose `last_ts` is older than
  `RETENTION_DAYS` (default 7; `0` disables).
- Whole-session granularity only — never partial truncation.
- Manual deletion via `DELETE /api/sessions/:id`.
- No size-based cap (at ~300–500 bytes/event, a heavy week is a few hundred
  MB; revisit only if real usage disproves this).

## 7. Web UI (Phases 3–4)

Designed in Claude Design against the frozen `API.md`; implemented as a
Vite + React SPA served from the server's `public/` dir. Requirements
(detailed in the Phase 3 brief, restated here for completeness):

1. **Session list** — start time, duration, sources, event count, error
   count; optimized for "which run had the failure" scanning.
2. **Session detail** (core screen) — dense virtualized log view smooth at
   100k rows: composable URL-shareable filters (ns wildcards, level, source,
   free text); clear source distinction when interleaved; expandable ctx
   JSON; timestamps switchable absolute / relative-to-start / delta-from-
   previous; density minimap with error positions and click-to-jump; SSE live
   tail with pause-on-scroll; pinned rows surviving filter changes.

Direction: pro developer tool — dark mode default, information-dense,
monospace log content, keyboard-first (j/k, /, f), sub-100ms interactions,
minimal chrome, no dashboards.

## 8. Error handling summary

| Failure | Behavior |
|---|---|
| Malformed JSON body | `400` with message |
| Event missing `msg` | rejected (single) / skipped + counted (batch) |
| Unknown `level`, bad `ts` | coerced, never rejected |
| Oversized body/batch | `413` |
| Server down (client) | one `console.warn`, then silent buffering + drop-oldest |
| Page unload (browser) | sendBeacon flush |
| SSE disconnect | client reconnects with `after_seq` = last seen, lossless |

Principle: a log tool must be maximally accepting — rejecting logs during
debugging is the worst possible failure mode. Coercion over rejection.

## 9. Testing

- **Unit:** validation/coercion matrix; ns-pattern → GLOB translation;
  retention selection logic.
- **Integration (real server + tmp DB):** ingest batch → query with each
  filter → export NDJSON → SSE receives live events and resumes correctly
  from `after_seq`.
- **End-to-end:** `examples/demo.ts` starts the server, emits a realistic
  two-source (webapp + api) session, and verifies query-back via HTTP —
  doubles as the smoke test and produces the reference session for Phase 3
  design work.

## 10. Delivery phases (user-gated)

1. **Brainstorm** — done; all recommendations approved 2026-07-13.
2. **Backend** — server + client helper + demo script; freeze `API.md`;
   README section for AI coding agents. STOP for review.
3. **UI design exploration** — two visual directions in Claude Design with
   realistic fake data. STOP for direction pick.
4. **Implement** — SPA against `API.md`, verified end-to-end against the
   Phase 2 demo session.
