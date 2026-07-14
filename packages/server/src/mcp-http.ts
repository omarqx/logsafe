// mcp-http.ts — serve the logsafe MCP tools over HTTP at POST /mcp using a
// stateless Streamable HTTP transport. Each request builds a fresh McpServer
// (via createMcpServer) + transport, handles the request, and tears down.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
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

  const methodNotAllowed = (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).send({ error: 'method not allowed; use POST' })
  app.get('/mcp', methodNotAllowed)
  app.delete('/mcp', methodNotAllowed)
}
