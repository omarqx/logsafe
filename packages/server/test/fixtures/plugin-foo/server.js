/** @type {import('@coglet/logsafe-plugin-sdk/server').ServerPlugin} */
const plugin = {
  matchType: (e) => (e.source === 'foo' ? 'foo' : null),
  migrate: (ctx) => { ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('marks')} (session_id TEXT, seq INTEGER)`) },
  afterInsert: (events, ctx) => {
    const ins = ctx.db.prepare(`INSERT INTO ${ctx.db.table('marks')} VALUES (?, ?)`)
    for (const e of events) ins.run(e.session_id, e.seq)
  },
  onSessionDelete: (sessionId, ctx) => { ctx.db.prepare(`DELETE FROM ${ctx.db.table('marks')} WHERE session_id = ?`).run(sessionId) },
  routes: (r) => { r.get('/marks/:session', (req) => ({ session: req.params.session })) },
}
export default plugin
