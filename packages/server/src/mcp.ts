// logsafe mcp — stdio MCP server for AI agents (Cursor, Claude Code, any
// MCP client). A thin, READ-ONLY HTTP client of a running logsafe server:
// it never opens the SQLite db; the frozen HTTP contract (API.md) stays
// the single API.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRequire } from 'node:module'
import { z } from 'zod'

const DEFAULT_URL = 'http://127.0.0.1:4600'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}
function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function createMcpServer(base: string): McpServer {
  async function api(path: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    let res: Response
    try {
      res = await fetch(`${base}${path}`)
    } catch {
      return { ok: false, error: `logsafe server not reachable at ${base} — start it with \`npx logsafe\`` }
    }
    if (res.status === 404) return { ok: false, error: 'not found: unknown session id' }
    if (!res.ok) return { ok: false, error: `logsafe server responded ${res.status}` }
    return { ok: true, data: await res.json() }
  }

  const pkg = createRequire(import.meta.url)('../package.json') as { version: string }
  const server = new McpServer({ name: 'logsafe', version: pkg.version })

  server.tool(
    'list_sessions',
    'List logsafe debug sessions, newest first. Fields per session: id, label (human hint), sources, event_count, error_count, warn_count, status ("active" = received events in the last 60s), first_ts/last_ts/duration_ms.',
    {},
    async () => {
      const r = await api('/api/sessions')
      return r.ok ? ok(r.data) : fail(r.error)
    },
  )

  server.tool(
    'get_session',
    'Get one session summary by id.',
    { session_id: z.string() },
    async ({ session_id }) => {
      const r = await api(`/api/sessions/${encodeURIComponent(session_id)}`)
      return r.ok ? ok(r.data) : fail(r.error)
    },
  )

  const queryShape = {
    session_id: z.string(),
    ns: z.string().optional().describe('namespace filter, comma-OR, * wildcard: "auth:*,player.*"'),
    level: z.string().optional().describe('comma-OR levels: "warn,error"'),
    source: z.string().optional().describe('comma-OR sources: "webapp,api"'),
    trace: z.string().optional().describe('exact trace id — follows one request across sources'),
    q: z.string().optional().describe('case-insensitive text search over msg and ctx'),
    from_ts: z.number().optional().describe('epoch ms lower bound on ts'),
    to_ts: z.number().optional().describe('epoch ms upper bound on ts'),
    after_seq: z.number().optional().describe('pagination cursor: events with seq > this'),
    limit: z.number().optional().describe('default 500, max 10000'),
  }

  function toParams(args: Record<string, unknown>): string {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(args)) {
      if (k === 'session_id' || v === undefined) continue
      sp.set(k, String(v))
    }
    const s = sp.toString()
    return s === '' ? '' : `?${s}`
  }

  server.tool(
    'query_events',
    'Query a session\'s events. All filters AND together. Results are ordered by seq ASC (server arrival order — trust seq, not ts, for ordering); returns { events, next_after_seq } — pass next_after_seq back as after_seq to page. Read narrow-first: level="error", then trace=, then widen.',
    queryShape,
    async (args) => {
      const r = await api(`/api/sessions/${encodeURIComponent(args.session_id)}/events${toParams(args)}`)
      return r.ok ? ok(r.data) : fail(r.error)
    },
  )

  server.tool(
    'tail_session',
    'Wait (bounded) for NEW events in a session — use while reproducing a bug. Polls until something arrives after after_seq or timeout_s (default 10, max 30) elapses; returns { events, next_after_seq } (possibly empty on timeout — not an error). If after_seq is omitted, tails from the current end of the session.',
    {
      session_id: z.string(),
      after_seq: z.number().optional(),
      timeout_s: z.number().optional(),
    },
    async ({ session_id, after_seq, timeout_s }) => {
      const timeoutMs = Math.min(Math.max(1, timeout_s ?? 10), 30) * 1000
      let cursor = after_seq
      if (cursor === undefined) {
        // Default to "now": find the session's current tip via its last_ts.
        const s = await api(`/api/sessions/${encodeURIComponent(session_id)}`)
        if (!s.ok) return fail(s.error)
        const lastTs = (s.data as { last_ts: number }).last_ts
        const probe = await api(`/api/sessions/${encodeURIComponent(session_id)}/events?from_ts=${lastTs}&limit=1`)
        if (!probe.ok) return fail(probe.error)
        const first = (probe.data as { events: { seq: number }[] }).events[0]
        cursor = first === undefined ? 0 : first.seq
      }
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const r = await api(`/api/sessions/${encodeURIComponent(session_id)}/events?after_seq=${cursor}&limit=1000`)
        if (!r.ok) return fail(r.error)
        const page = r.data as { events: unknown[]; next_after_seq: number | null }
        if (page.events.length > 0) return ok(page)
        if (Date.now() >= deadline) return ok({ events: [], next_after_seq: cursor })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    },
  )

  return server
}

export async function runMcp(urlArg?: string): Promise<void> {
  const base = (urlArg ?? process.env.LOGSAFE_URL ?? DEFAULT_URL).replace(/\/+$/, '')
  const server = createMcpServer(base)
  await server.connect(new StdioServerTransport())
}
