import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FastifyInstance } from 'fastify'
import net from 'node:net'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { registerMcpHttp } from '../src/mcp-http.js'

let app: FastifyInstance
let base: string
let client: Client

// Fastify refuses to add routes after listen(). registerMcpHttp needs `base`
// (which embeds the port), but the port is normally only known once we've
// listened. Break the cycle by pre-binding a throwaway socket on port 0 to
// reserve a free port, closing it, then having Fastify listen on that same
// port after routes (including /mcp) are registered.
async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('no port'))
        return
      }
      const { port } = addr
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

beforeAll(async () => {
  app = buildApp({ db: openDb(':memory:') })
  const port = await reserveFreePort()
  base = `http://127.0.0.1:${port}`
  registerMcpHttp(app, base) // in-process tools call this same server on loopback
  await app.listen({ host: '127.0.0.1', port })

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

  it('DELETE /mcp is 405', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/mcp' })
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
