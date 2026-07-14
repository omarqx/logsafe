import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/**
 * Serve the built UI from `publicDir` and fall back to `index.html` for any
 * GET request that isn't under /api or /v1, so client-side routes (e.g.
 * `/s/:id`) work as deep links. API/log routes keep their normal JSON 404s.
 */
export async function registerSpa(app: FastifyInstance, publicDir: string): Promise<void> {
  await app.register(fastifyStatic, { root: publicDir })

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/v1')) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.code(404).send({ error: 'not found' })
  })
}
