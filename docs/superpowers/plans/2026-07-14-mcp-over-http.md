# logsafe — MCP over HTTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, checkbox steps. NO Co-Authored-By trailers (hard user rule for this repo).

**Goal:** Serve the existing four MCP tools over HTTP at `POST /mcp` from the running logsafe server (stateless, on by default), keeping the stdio `logsafe mcp` subcommand.

**Architecture:** Refactor the tool wiring out of `runMcp()` into an exported `createMcpServer(base)` factory; stdio and a new Fastify `/mcp` route both consume it. In-process, tools call the logsafe HTTP API on loopback — one tool implementation, frozen contract unchanged.

**Tech Stack:** `@modelcontextprotocol/sdk@1.29.x` (`StreamableHTTPServerTransport` + `StreamableHTTPClientTransport`), Fastify 5, vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-mcp-over-http-design.md`

## Global Constraints

- No change to tool names/args/behavior or to `API.md`. `/mcp` is additive.
- Stateless transport: `sessionIdGenerator: undefined`, fresh `McpServer`+transport per request, closed when the response finishes. GET/DELETE `/mcp` → `405`.
- Host/Origin guard (deprecated transport option NOT used): `/mcp` returns `403` unless `Host` hostname ∈ {127.0.0.1, localhost} and any present `Origin` is loopback.
- On by default: `serve.ts` registers `/mcp` with base = its own `http://127.0.0.1:${PORT}`.
- The existing `packages/server/test/mcp.test.ts` (stdio) MUST still pass unchanged — proof the refactor preserved behavior.
- TypeScript strict, ESM. NO Co-Authored-By trailers. Commit per task.

## SDK facts (verified against installed types)

- `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` → stateless. `enableJsonResponse: true` returns a plain JSON body instead of opening an SSE stream — the right fit for these request/response tools and simpler to drive in tests.
- `await transport.handleRequest(req.raw, reply.raw, parsedBody)` drives the exchange over Node req/res.
- `enableDnsRebindingProtection`/`allowedHosts`/`allowedOrigins` are `@deprecated` — do the host check ourselves.
- Client side (test): `new StreamableHTTPClientTransport(new URL(base + '/mcp'))` + `new Client(...)`.

---

### Task 1: Refactor `mcp.ts` to expose `createMcpServer(base)` (behavior-preserving)

**Files:** Modify: `packages/server/src/mcp.ts`. Test: existing `packages/server/test/mcp.test.ts` is the regression gate (unchanged).

**Interfaces produced:** `export function createMcpServer(base: string): McpServer` — builds the `api()` helper (loopback-tolerant, same messages) and registers all four tools (list_sessions, get_session, query_events, tail_session) exactly as they exist today. `runMcp(urlArg?)` becomes: compute base, `const server = createMcpServer(base)`, `await server.connect(new StdioServerTransport())`.

- [ ] **Step 1: Refactor** — move everything currently inside `runMcp` from the `api()` helper through the four `server.tool(...)` registrations into `createMcpServer(base: string): McpServer`. It creates `const server = new McpServer({ name: 'logsafe', version: pkg.version })`, registers the tools against `base`, and `return server`. Keep the `ok`/`fail`/`ToolResult` helpers module-level (they're already there). `runMcp` keeps the base-resolution line (`urlArg ?? LOGSAFE_URL ?? DEFAULT_URL`, strip trailing slash) then calls the factory and connects stdio. Do NOT change any tool description, arg shape, or fetch path.

- [ ] **Step 2: Verify no behavior drift** — `npx vitest run packages/server/test/mcp.test.ts` (6 tests, unchanged, all pass); `npm run typecheck` clean.

- [ ] **Step 3: Commit** — `refactor(mcp): extract createMcpServer factory for reuse across transports`

### Task 2: `mcp-http.ts` — Fastify `/mcp` route (TDD)

**Files:** Create: `packages/server/src/mcp-http.ts`, `packages/server/test/mcp-http.test.ts`.

**Interfaces produced:** `export function registerMcpHttp(app: FastifyInstance, base: string): void` — registers `POST /mcp` (stateless StreamableHTTP over the factory), and `GET`/`DELETE /mcp` → 405. `base` is the logsafe HTTP base the in-process tools call.

- [ ] **Step 1: Write the failing integration test** — `packages/server/test/mcp-http.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { registerMcpHttp } from '../src/mcp-http.js'

let app: FastifyInstance
let base: string
let client: Client

beforeAll(async () => {
  app = buildApp({ db: openDb(':memory:') })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const addr = app.server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  base = `http://127.0.0.1:${addr.port}`
  registerMcpHttp(app, base) // in-process tools call this same server on loopback
  // registerMcpHttp adds a route after listen(); if Fastify rejects late route
  // adds, move registerMcpHttp before listen and re-read addr from a 0-port
  // pre-bind — see Step 3 note.

  await fetch(`${base}/v1/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([
      { session_id: 's1', session_label: 'http mcp test', source: 'api', ns: 'auth:token', level: 'error', msg: 'boom' },
      { session_id: 's1', source: 'api', ns: 'http', level: 'info', msg: 'ok' },
    ]),
  })

  client = new Client({ name: 'http-test', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)))
}, 30_000)

afterAll(async () => {
  await client?.close()
  await app?.close()
})

describe('POST /mcp (streamable http)', () => {
  it('lists exactly the four read-only tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual(['get_session', 'list_sessions', 'query_events', 'tail_session'])
  })

  it('list_sessions returns the fixture session', async () => {
    const res = await client.callTool({ name: 'list_sessions', arguments: {} })
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('http mcp test')
    expect(text).toContain('"error_count": 1')
  })

  it('query_events applies filters', async () => {
    const res = await client.callTool({ name: 'query_events', arguments: { session_id: 's1', level: 'error' } })
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('boom')
    expect(text).not.toContain('"msg": "ok"')
  })

  it('tail_session returns new events within the timeout', async () => {
    const call = client.callTool({ name: 'tail_session', arguments: { session_id: 's1', after_seq: 2, timeout_s: 8 } })
    await new Promise((r) => setTimeout(r, 1200))
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', source: 'api', ns: 'live', msg: 'tailed!' }),
    })
    const res = await call
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('tailed!')
  }, 15_000)

  it('unknown session surfaces the API 404 clearly', async () => {
    const res = await client.callTool({ name: 'get_session', arguments: { session_id: 'nope' } })
    expect(res.isError).toBe(true)
    expect((res.content as { type: string; text: string }[])[0].text.toLowerCase()).toContain('not found')
  })

  it('GET /mcp is 405', async () => {
    const res = await app.inject({ method: 'GET', url: '/mcp' })
    expect(res.statusCode).toBe(405)
  })

  it('rejects a non-loopback Host header with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: 'evil.example.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.statusCode).toBe(403)
  })
})
```

Run: `npx vitest run packages/server/test/mcp-http.test.ts` → FAILS (no `../src/mcp-http.js`).

- [ ] **Step 2: Implement `packages/server/src/mcp-http.ts`**

```ts
// mcp-http.ts — serve the logsafe MCP tools over HTTP at POST /mcp using a
// stateless Streamable HTTP transport. Each request builds a fresh McpServer
// (via createMcpServer) + transport, handles the request, and tears down.
import type { FastifyInstance } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './mcp.js'

/** Only 127.0.0.1 / localhost may reach /mcp — blocks browser DNS-rebinding
    against an unauthenticated loopback endpoint. */
function isLoopbackHost(value: string | undefined): boolean {
  if (!value) return false
  // strip an optional :port; also handle a bare Origin like http://127.0.0.1:4600
  const host = value.replace(/^https?:\/\//, '').split('/')[0]
  const name = host.replace(/:\d+$/, '')
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

export function registerMcpHttp(app: FastifyInstance, base: string): void {
  app.post('/mcp', async (req, reply) => {
    if (!isLoopbackHost(req.headers.host)) {
      return reply.code(403).send({ error: 'forbidden host' })
    }
    const origin = req.headers.origin
    if (origin !== undefined && !isLoopbackHost(origin)) {
      return reply.code(403).send({ error: 'forbidden origin' })
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = createMcpServer(base)
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    reply.hijack()
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })

  const methodNotAllowed = (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(405).send({ error: 'method not allowed; use POST' })
  app.get('/mcp', methodNotAllowed as never)
  app.delete('/mcp', methodNotAllowed as never)
}
```

**Integration notes for the implementer (resolve, don't guess):**
- Fastify parses JSON bodies by default, so `req.body` is the parsed object the transport wants. But `buildApp` also registers a catch-all `*` content-type parser (for the log ingest bare-curl path) — confirm `POST /mcp` with `content-type: application/json` still yields a parsed object in `req.body` (it should; the built-in JSON parser wins for `application/json`). If the transport receives a string, parse it.
- `reply.hijack()` hands raw-socket control to the transport (same pattern the SSE/ndjson routes already use in `app.ts`). Register the `close` cleanup BEFORE `handleRequest`.
- The Streamable HTTP client sends `Accept: application/json, text/event-stream`; with `enableJsonResponse: true` the server replies JSON. If the SDK version's `handleRequest` signature differs, adapt to the installed types (the contract is: stateless, JSON response, driven from `req.raw`/`reply.raw`).
- If adding routes after `app.listen()` throws in the test, move `registerMcpHttp` before `listen` there (and in serve.ts it's already before listen).

- [ ] **Step 3: Green** — `npx vitest run packages/server/test/mcp-http.test.ts` (7 tests). Then full `npm test` and `npm run typecheck` clean.

- [ ] **Step 4: Commit** — `feat(mcp): serve MCP over HTTP at POST /mcp (stateless, loopback-guarded)`

### Task 3: Wire into `serve.ts` + docs

**Files:** Modify: `packages/server/src/serve.ts`, `README.md`, `packages/server/README.md`, `packages/server/skills/debugging-with-logsafe/SKILL.md`.

- [ ] **Step 1: serve.ts** — after `buildApp`, before `app.listen`, add:

```ts
import { registerMcpHttp } from './mcp-http.js'
// ...
const SELF_BASE = `http://127.0.0.1:${PORT}`
registerMcpHttp(app, SELF_BASE)
```

(Place it alongside the existing `registerSpa` block, before `listen`.) Add one line to the startup log so users see it: append `  MCP: ${address}/mcp` to the existing listening line, or a second `console.log`.

- [ ] **Step 2: Docs** — in both READMEs' "Hooking up an AI agent" area and SKILL.md, add the URL form next to the stdio form:

````markdown
**MCP over HTTP (no subprocess)** — a running logsafe server hosts MCP at `/mcp`:

```bash
claude mcp add --transport http logsafe http://127.0.0.1:4600/mcp
```

```jsonc
// Cursor ~/.cursor/mcp.json
{ "mcpServers": { "logsafe": { "url": "http://127.0.0.1:4600/mcp" } } }
```

The stdio form (`npx logsafe mcp`) still works for stdio-only clients.
````

SKILL.md step 1: note the MCP is at `/mcp` when the server runs.

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npm test` green; live smoke: `npm run build -w packages/server` then start the compiled server on a scratch DB + free port and connect a real StreamableHTTP client (or reuse the test) — confirm `list_sessions` works end to end and the startup log shows the `/mcp` line. Capture output.

- [ ] **Step 4: Commit** — `feat(mcp): host /mcp by default from the server + document URL setup`

## Exit criteria

1. `npm test` green (stdio mcp suite unchanged + new http suite), `npm run typecheck` clean.
2. A real StreamableHTTP client drives all four tools against a live server; GET /mcp → 405; non-loopback Host → 403.
3. `serve.ts` hosts `/mcp` by default; startup log shows it.
4. Docs show both URL and stdio setup. No Co-Authored-By trailers.
