# logsafe

logsafe is a local debugging log server: point any app (or any HTTP client)
at it and it collects log events into named **sessions**, stored in a local
SQLite database. It groups related events (across multiple processes or
sources — a browser tab and its backend, say) so you can filter, search, and
tail them while you debug. A web UI for browsing sessions ships built in
(see below); everything is also available over plain HTTP (see `API.md`).

## Quickstart

```bash
npx logsafe
# [logsafe] listening on http://127.0.0.1:4600  (db: ~/.logsafe/logsafe.db, retention: 7d)
```

Send it a log line:

```bash
curl -s localhost:4600/v1/log -d '{"msg":"hello world"}'
# {"accepted":1,"rejected":0}

curl -s localhost:4600/api/sessions | jq
```

## Web UI

The web UI ships built in — no separate build step needed. It's served at
the same port as the API:

```bash
npx logsafe
# open http://127.0.0.1:4600
```

Session list → click into a session for the dense log stream: composable
filters, an error/density minimap, per-row expandable ctx JSON, and a live
tail over SSE.

## Logging from your app

### JavaScript/TypeScript: `logsafe-client`

Zero-dependency helper for browser or Node apps. It batches events and
sends them over `POST /v1/log`.

```ts
import { initLogsafe, createLog } from 'logsafe-client'

const { sessionId } = initLogsafe({ source: 'webapp' })
const log = createLog('cart')
log.info('cart hydrated', { items: 3, total_cents: 8497 })
```

### Any other language: it's just HTTP POST

There's no SDK requirement — anything that can make an HTTP request can log
to logsafe. Send a JSON object or a JSON array of objects to `POST /v1/log`:

```bash
curl -s localhost:4600/v1/log -d '[
  {"session_id": "s1", "source": "api", "ns": "http", "level": "info",  "msg": "GET /api/cart 200", "ctx": {"ms": 12}},
  {"session_id": "s1", "source": "api", "ns": "http", "level": "error", "msg": "POST /api/checkout 500", "ctx": {"ms": 340}}
]'
# {"accepted":2,"rejected":0}
```

Only `msg` is required — everything else has a sane default. See `API.md`
for the full field table, coercion rules, and status codes.

## AI agents

**MCP (Cursor, Claude Code, any MCP client)** — logsafe ships an MCP server:

```jsonc
// Cursor: ~/.cursor/mcp.json
{ "mcpServers": { "logsafe": { "command": "npx", "args": ["logsafe", "mcp"] } } }
```

```bash
# Claude Code:
claude mcp add logsafe -- npx logsafe mcp
```

Tools: `list_sessions`, `get_session`, `query_events`, `tail_session` —
read-only, talking to your local server.

**MCP over HTTP (no subprocess)** — a running logsafe server hosts MCP at `/mcp`:

```bash
claude mcp add --transport http logsafe http://127.0.0.1:4600/mcp
```

```jsonc
// Cursor ~/.cursor/mcp.json
{ "mcpServers": { "logsafe": { "url": "http://127.0.0.1:4600/mcp" } } }
```

The stdio form (`npx logsafe mcp`) still works for stdio-only clients.

**Skill (Claude Code)** — a debugging workflow skill ships with this package:

```bash
cp -r node_modules/logsafe/skills/debugging-with-logsafe ~/.claude/skills/
```

## Configuration

Environment variables, read at server startup:

| Var | Default | Notes |
|---|---|---|
| `PORT` | `4600` | Server listens on `127.0.0.1:<PORT>` (local only). Non-numeric falls back to the default with a warning. |
| `LOGSAFE_DB` | `~/.logsafe/logsafe.db` | Path to the SQLite database file. Parent directories are created automatically. |
| `RETENTION_DAYS` | `7` | Sessions older than this (by last event) are pruned automatically at startup and hourly. `0` or negative disables pruning. |

```bash
LOGSAFE_DB=/tmp/logsafe-scratch.db PORT=4601 npx logsafe
```

## Docs

Full docs, including the frozen HTTP contract (`API.md`), are at
https://github.com/omarqx/logsafe.
