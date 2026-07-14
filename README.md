# deblog

## What is this

deblog is a local debugging log server: point any app (or any HTTP client)
at it and it collects log events into named **sessions**, stored in a local
SQLite database. It groups related events (across multiple processes or
sources — a browser tab and its backend, say) so you can filter, search, and
tail them while you debug. A web UI for browsing sessions is coming in a
later phase; for now everything is available over plain HTTP (see
`API.md`).

## Quickstart

```bash
npm install
npm start
# [deblog] listening on http://127.0.0.1:4600  (db: ~/.deblog/deblog.db, retention: 7d)
```

Send it a log line:

```bash
curl -s localhost:4600/v1/log -d '{"msg":"hello world"}'
# {"accepted":1,"rejected":0}

curl -s localhost:4600/api/sessions | jq
```

Or run the bundled demo, which emits a realistic multi-source session and
verifies it back over the API:

```bash
npm run demo -- --keep   # leaves the server running so you can explore
```

## Logging from your app

### JavaScript/TypeScript: `@deblog/client`

Zero-dependency helper for browser or Node apps. It batches events and
sends them over `POST /v1/log`.

```ts
import { initDeblog, createLog } from '@deblog/client'

const { sessionId } = initDeblog({
  source: 'webapp',              // required: identifies this process/app
  sessionLabel: 'checkout flow', // optional, human-readable
  // url: 'http://127.0.0.1:4600' (default)
})

const log = createLog('cart')    // ns: a dotted/colon namespace for this logger
log.info('cart hydrated', { items: 3, total_cents: 8497 })
log.error('payment failed', { status: 502 })

// Follow one request/operation across sources by sharing a trace id:
const reqLog = createLog('cart:payment').withTrace(`req-${sessionId.slice(0, 6)}`)
reqLog.info('submitting payment', { provider: 'stripe' })
```

Events are buffered and flushed automatically (every 250ms, or immediately
at 64 buffered events), and flushed on page unload via `sendBeacon`. Call
`flush()` to force-send (useful before a script exits, e.g. in tests or a
CLI tool).

### Any other language: it's just HTTP POST

There's no SDK requirement — anything that can make an HTTP request can log
to deblog. Send a JSON object or a JSON array of objects to `POST /v1/log`:

```bash
curl -s localhost:4600/v1/log -d '[
  {"session_id": "s1", "source": "api", "ns": "http", "level": "info",  "msg": "GET /api/cart 200", "ctx": {"ms": 12}},
  {"session_id": "s1", "source": "api", "ns": "http", "level": "error", "msg": "POST /api/checkout 500", "ctx": {"ms": 340}}
]'
# {"accepted":2,"rejected":0}
```

Only `msg` is required — everything else has a sane default. See `API.md`
for the full field table, coercion rules, and status codes.

## For AI coding agents

If you're an agent debugging an app that logs to deblog, this is the fast
path to finding and reading its logs. Full field/param reference is in
`API.md`.

- **Server:** runs locally at `http://127.0.0.1:4600` by default. Check it's
  up with `curl -s localhost:4600/api/health` → `{"ok":true}`.
- **Find the relevant session:**
  ```bash
  curl -s localhost:4600/api/sessions | jq
  ```
  Sessions are returned **newest first**. Look at `label` (human-readable
  hint), `sources` (which processes logged to it), `error_count`/
  `warn_count` (is something obviously wrong), and `status` — `"active"`
  means it received an event in the last 60 seconds, i.e. the app is
  probably still running right now.
- **Read it, narrowest filter first:**
  ```bash
  curl -s 'localhost:4600/api/sessions/<id>/events?level=error' | jq
  ```
  Then widen as needed:
  - `level=warn,error` — multiple levels, comma-OR'd.
  - `ns=auth:*` — namespace wildcard (`*` only; matches any run of chars).
  - `q=timeout` — case-insensitive text search across `msg` and `ctx`.
  - `trace=req-abc123` — follow one request/operation across every source
    that tagged it with the same trace id (e.g. frontend + backend for one
    HTTP call).
  These all AND together, e.g.
  `?level=error&source=api&trace=req-abc123` narrows to error-level events
  from the `api` source within one traced request.
- **Bulk analysis:** `GET /api/sessions/<id>/export.ndjson` streams every
  matching event (same filters as above) as one JSON object per line —
  pipe-friendly:
  ```bash
  curl -s 'localhost:4600/api/sessions/<id>/export.ndjson' | jq -c 'select(.level=="error")'
  ```
- **Pagination and ordering:** responses are always `seq ASC` (server
  insertion order). If `next_after_seq` is non-null, pass it back as
  `after_seq` on the next request to keep paging. Events carry both `ts`
  (the client's own clock, which can be skewed or backdated) and
  `received_at`/`seq` (server-assigned) — **trust `seq` for ordering**,
  not `ts`.
- **Live tail:** `GET /api/sessions/<id>/stream` is an SSE endpoint that
  replays history then streams new events as they arrive — useful for
  watching a session while reproducing a bug interactively.

## Configuration

Environment variables, read at server startup (`npm start`):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `4600` | Server listens on `127.0.0.1:<PORT>` (local only, not exposed on the network). An unset/empty value uses the default; a non-numeric value logs a warning and falls back to the default rather than failing to start. |
| `DEBLOG_DB` | `~/.deblog/deblog.db` | Path to the SQLite database file. Parent directories are created automatically. Use a throwaway path (e.g. `/tmp/deblog-test.db`) for scratch/test servers so you don't pollute your real log history. |
| `RETENTION_DAYS` | `7` | Sessions whose most recent event (`last_ts`) is older than this many days are deleted (session + all its events) automatically, at startup and then hourly. Same validation as `PORT`: non-numeric falls back to the default with a warning. `0` or negative disables pruning entirely. |

```bash
DEBLOG_DB=/tmp/deblog-scratch.db PORT=4601 npm start
```
