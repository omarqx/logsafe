// Starter server plugin. TODO: rename 'my-plugin' everywhere (package.json
// too), then edit matchType to claim your events. Every other hook is
// optional — uncomment what you need. Docs: docs/PLUGINS.md
import type { ServerPlugin } from '@coglet/logsafe-plugin-sdk/server'

const plugin: ServerPlugin = {
  // TODO: claim your events. Return your type string, or null to pass.
  matchType: (e) => (e.ns.startsWith('my-plugin:') ? 'my-plugin' : null),

  // transform: (e) => ({ ...e, ctx: { ...(e.ctx as object), enriched: true } }),
  // migrate: (ctx) => { ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('things')} (session_id TEXT, value REAL)`) },
  // afterInsert: (events, ctx) => { /* derive + write to your plugin_<id>_* tables */ },
  // routes: (router, ctx) => { router.get('/things/:sessionId', (req) => ({ sessionId: req.params.sessionId })) },
  // onSessionDelete: (sessionId, ctx) => { ctx.db.prepare(`DELETE FROM ${ctx.db.table('things')} WHERE session_id = ?`).run(sessionId) },
}

export default plugin
