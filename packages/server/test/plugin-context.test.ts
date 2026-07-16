import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db.js'
import { makePluginContext } from '../src/plugins/context.js'

describe('plugin context', () => {
  it('namespaces table names and can create/query a plugin table', () => {
    const db = openDb(':memory:')
    const ctx = makePluginContext(db, 'psdk')
    expect(ctx.pluginId).toBe('psdk')
    expect(ctx.db.table('views')).toBe('plugin_psdk_views')
    ctx.db.exec(`CREATE TABLE ${ctx.db.table('views')} (session_id TEXT, vst REAL)`)
    ctx.db.prepare(`INSERT INTO ${ctx.db.table('views')} VALUES (?, ?)`).run('s1', 1.2)
    const row = ctx.db.prepare(`SELECT vst FROM ${ctx.db.table('views')} WHERE session_id = ?`).get('s1') as { vst: number }
    expect(row.vst).toBe(1.2)
  })
})
