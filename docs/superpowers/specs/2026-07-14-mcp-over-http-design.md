# logsafe — MCP over HTTP: Design Spec

**Date:** 2026-07-14
**Status:** Approved (design + recommendations signed off)

## 1. Purpose

Let the running `logsafe` server host its MCP interface over HTTP at `/mcp`,
so an AI agent connects by URL with zero install — no `npx logsafe mcp`
subprocess. The existing stdio subcommand stays for stdio-only clients.

Consistent with the project's posture: loopback-only, no auth, zero config.

### Out of scope

- Any change to the four tools' names, args, or behavior.
- Any change to the frozen HTTP API (`API.md`) — `/mcp` is additive.
- Stateful MCP sessions / server-initiated push (see §3, decision 1).
- Auth (the server is 127.0.0.1-only, matching every other endpoint).

## 2. Architecture

The four tools already exist in `packages/server/src/mcp.ts`, wired inline
inside `runMcp()`. Refactor so the wiring is reusable, then serve it over
two transports from one implementation.

- **`createMcpServer(base: string): McpServer`** — new exported factory.
  Contains the `api()` helper + the four `server.tool(...)` registrations
  (list_sessions, get_session, query_events, tail_session), verbatim from
  the current `runMcp`. `base` is the logsafe HTTP base URL the tools call.
- **`runMcp(urlArg?)` (stdio, existing command)** — becomes
  `createMcpServer(base)` + `StdioServerTransport`. Behavior unchanged.
- **`registerMcpHttp(app, base)` (new, `mcp-http.ts`)** — a Fastify plugin
  mounting `POST /mcp`. Stateless `StreamableHTTPServerTransport`: per
  request, build a fresh `McpServer` via the factory + a fresh transport
  (`sessionIdGenerator: undefined`), `await server.connect(transport)`,
  `transport.handleRequest(req.raw, reply.raw, body)`, and close both when
  the response finishes. `GET`/`DELETE /mcp` return `405` (no sessions to
  resume/terminate in stateless mode).
- **`serve.ts`** calls `registerMcpHttp(app, selfBase)` where `selfBase` is
  the server's own loopback address (`http://127.0.0.1:${PORT}`). The
  in-process tools thus reach data by calling the logsafe HTTP API on
  loopback — one tool implementation, the frozen contract stays the single
  API, negligible self-request cost.

### Why call itself over HTTP rather than the db directly

Keeps exactly one implementation of the tools (the same code serves stdio
against a remote logsafe and HTTP in-process) and preserves "the HTTP
contract is the single API." A loopback self-request is microseconds.

## 3. Decisions

1. **Stateless transport.** All four tools are request→response (even
   `tail_session` just holds the POST open while polling, then returns) —
   no server push, no session map, no lifecycle endpoints.
   `sessionIdGenerator: undefined`; a new `McpServer`+transport per request.
2. **On by default.** Every `logsafe` server hosts `/mcp`. No flag, matching
   the loopback/no-auth/zero-config posture.
3. **DNS-rebinding protection ON.** Enable the transport's
   `enableDnsRebindingProtection` with `allowedHosts: ['127.0.0.1', 'localhost']`
   (and their `:PORT` forms). Cheap hardening for an unauthenticated
   loopback endpoint that ships publicly.

## 4. Error handling

| Case | Behavior |
|---|---|
| Tool's loopback fetch fails | Existing `fail()` tool-result path (unchanged) |
| GET/DELETE /mcp | `405` JSON, per stateless spec |
| Malformed MCP body | Transport returns the MCP-standard JSON-RPC error |
| Rebinding-protection reject | Transport `403` (bad Host/Origin) |
| Transport error mid-request | Close transport + server; do not crash the process |

## 5. Testing

- Integration test (`mcp-http.test.ts`): boot a real server with `/mcp`
  registered, connect with the SDK's `StreamableHTTPClientTransport` +
  `Client`, and exercise all four tools (list/get/query/tail) plus the
  unknown-session error path — mirroring the stdio suite, over HTTP.
- The existing stdio `mcp.test.ts` must still pass unchanged (proves the
  factory refactor preserved behavior).
- `GET /mcp` → 405 assertion.

## 6. Docs

- README "Hooking up an AI agent": add the URL form alongside stdio —
  `claude mcp add --transport http logsafe http://127.0.0.1:4600/mcp` and
  the Cursor URL-style `mcpServers` entry — noting the server must be
  running and stdio remains for stdio-only clients.
- SKILL.md: one line that the MCP is reachable at `/mcp` when the server
  runs, else `npx logsafe mcp`.

## 7. Delivery

One short plan, one implementer + review loop. Ships as a follow-up commit
(candidate for a 0.2.0 alongside the demo-serves-UI change on the
`demo-serves-ui` branch, or its own branch — controller's call at merge).
