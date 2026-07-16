import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { LoadedServerPlugin } from './loader.js'
import type { PluginRouter, PluginRouteHandler } from '@coglet/logsafe-plugin-sdk/server'

/** Adapt a plugin's route registrations onto Fastify under a fixed prefix.
 *  Handler return values are sent as JSON (200); thrown errors become 500. */
export function mountPluginRoutes(app: FastifyInstance, plugins: LoadedServerPlugin[]): void {
  for (const p of plugins) {
    if (!p.plugin.routes) continue
    const prefix = `/api/plugins/${p.manifest.id}`
    const adapt = (handler: PluginRouteHandler) => async (req: FastifyRequest, _reply: FastifyReply) => {
      const result = await handler({
        params: (req.params ?? {}) as Record<string, string>,
        query: (req.query ?? {}) as Record<string, string>,
        body: req.body,
      })
      return result
    }
    // Routes registered without a leading slash are normalized, matching makePluginFetch
    const mount = (path: string) => `${prefix}${path.startsWith('/') ? path : `/${path}`}`
    const router: PluginRouter = {
      get: (path, handler) => { app.get(mount(path), adapt(handler)) },
      post: (path, handler) => { app.post(mount(path), adapt(handler)) },
    }
    p.plugin.routes(router, p.ctx)
  }
}
