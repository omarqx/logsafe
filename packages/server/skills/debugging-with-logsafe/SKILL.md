---
name: debugging-with-logsafe
description: Use when debugging a running application whose behavior you can reproduce — instrument the app with logsafe structured logging, reproduce the bug, and read the session narrow-first (errors → trace → widen). Works via logsafe MCP tools when connected, or plain HTTP/curl.
---

# Debugging with logsafe

logsafe is a local log server (default `http://127.0.0.1:4600`). Apps POST
structured events; you read them back as filterable sessions. Ordering is
always server arrival order (`seq`) — never trust client `ts` for ordering.

## Workflow

1. **Check the server.** MCP: call `list_sessions`. HTTP:
   `curl -s localhost:4600/api/health` → `{"ok":true}`. If down, start it:
   `npx @coglet/logsafe` (background it; it binds 127.0.0.1 only). A running server
   also hosts MCP over HTTP at `/mcp` (`claude mcp add --transport http logsafe http://127.0.0.1:4600/mcp`) —
   no subprocess needed.
2. **Instrument the app under debug.** Always set a fresh, descriptive
   `session_label` per attempt so the session is findable.
   - JS/TS: `npm i @coglet/logsafe-client`, then
     `initLogsafe({ source: 'api', sessionLabel: 'bug-1234 attempt 1' })`
     and `createLog('payment')` → `log.debug/info/warn/error(msg, ctx)`.
     Use `createLog(ns).withTrace(id)` to follow one request across
     processes — give the SAME trace id to frontend and backend.
   - Anything else: POST JSON to `/v1/log` — only `msg` is required:
     `curl -s localhost:4600/v1/log -d '{"session_id":"bug-1234","source":"api","ns":"payment","level":"error","msg":"...","ctx":{...}}'`
3. **Reproduce the bug** with the instrumented app.
4. **Read narrow-first.**
   - MCP: `query_events(session_id, level: "error")`, then
     `query_events(session_id, trace: "<id>")`, then widen
     (`level: "warn,error"`, `ns: "payment.*"`, `q: "timeout"`).
   - HTTP: same params on `GET /api/sessions/<id>/events`.
   - Bulk analysis: `GET /api/sessions/<id>/export.ndjson` (one JSON per line).
5. **Live-tail while re-reproducing** to watch cause → effect in order.
   - MCP: `tail_session(session_id)` right before triggering the bug —
     it waits (≤30s) and returns what arrived.
   - HTTP: `curl -N localhost:4600/api/sessions/<id>/stream`.
6. **Clean up** instrumentation when fixed: grep the app for the `ns`
   values you added.

## Reading results

- Sessions list is newest-first; `status: "active"` = events in the last 60s.
- `error_count`/`warn_count` on the session tell you where to look first.
- `next_after_seq` is the pagination cursor — pass it back as `after_seq`.
- `ctx` is arbitrary JSON the app attached; `received_at` vs `ts` exposes
  client clock skew.
