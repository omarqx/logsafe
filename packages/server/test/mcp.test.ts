import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'

const SERVER_DIR = path.resolve(import.meta.dirname, '..')

let app: FastifyInstance
let base: string
let client: Client

beforeAll(async () => {
  app = buildApp({ db: openDb(':memory:') })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const addr = app.server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  base = `http://127.0.0.1:${addr.port}`

  await fetch(`${base}/v1/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([
      { session_id: 's1', session_label: 'mcp test', source: 'api', ns: 'auth:token', level: 'error', msg: 'boom' },
      { session_id: 's1', source: 'api', ns: 'http', level: 'info', msg: 'ok' },
    ]),
  })

  client = new Client({ name: 'test', version: '0.0.0' })
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/cli.ts', 'mcp', '--url', base],
    cwd: SERVER_DIR,
  })
  await client.connect(transport)
}, 30_000)

afterAll(async () => {
  await client?.close()
  await app?.close()
})

describe('logsafe mcp', () => {
  it('exposes exactly the four read-only tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual(['get_session', 'list_sessions', 'query_events', 'tail_session'])
  })

  it('list_sessions returns the fixture session', async () => {
    const res = await client.callTool({ name: 'list_sessions', arguments: {} })
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('mcp test')
    expect(text).toContain('"error_count": 1')
  })

  it('query_events applies filters', async () => {
    const res = await client.callTool({
      name: 'query_events',
      arguments: { session_id: 's1', level: 'error' },
    })
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('boom')
    expect(text).not.toContain('"msg": "ok"')
  })

  it('tail_session returns new events within the timeout', async () => {
    const call = client.callTool({
      name: 'tail_session',
      arguments: { session_id: 's1', after_seq: 2, timeout_s: 8 },
    })
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
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text.toLowerCase()).toContain('not found')
  })
})

describe('logsafe mcp with no server', () => {
  it('tools return a friendly start-the-server error', async () => {
    const lone = new Client({ name: 'test2', version: '0.0.0' })
    const t = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/cli.ts', 'mcp', '--url', 'http://127.0.0.1:1'],
      cwd: SERVER_DIR,
    })
    await lone.connect(t)
    const res = await lone.callTool({ name: 'list_sessions', arguments: {} })
    expect(res.isError).toBe(true)
    expect((res.content as { type: string; text: string }[])[0].text).toContain('npx logsafe')
    await lone.close()
  }, 30_000)
})
