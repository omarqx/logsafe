import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'
import { buildApp } from '../src/app.js'
import { getSession } from '../src/queries.js'
import { makePluginContext } from '../src/plugins/context.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('plugin session cleanup', () => {
  it('drops plugin rows when the session is deleted', async () => {
    const db = openDb(':memory:')
    const plugins = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    const app = buildApp({ db, plugins })
    await app.inject({ method: 'POST', url: '/v1/log', payload: [{ msg: 'x', session_id: 's1', source: 'foo' }] })
    expect((db.prepare(`SELECT COUNT(*) c FROM plugin_foo_marks`).get() as { c: number }).c).toBe(1)

    const res = await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })
    expect(res.statusCode).toBe(204)
    expect((db.prepare(`SELECT COUNT(*) c FROM plugin_foo_marks`).get() as { c: number }).c).toBe(0)
    await app.close()
  })

  it('isolates a throwing onSessionDelete hook: core deletion still succeeds', async () => {
    const db = openDb(':memory:')
    const boomPlugin = {
      manifest: { id: 'boom', version: '0', apiVersion: '1', ownedTypes: ['boom'] },
      plugin: { onSessionDelete: () => { throw new Error('cleanup boom') } },
      ctx: makePluginContext(db, 'boom'),
    }
    const app = buildApp({ db, plugins: [boomPlugin] })
    await app.inject({ method: 'POST', url: '/v1/log', payload: [{ msg: 'x', session_id: 's1', source: 'foo' }] })

    const res = await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })
    expect(res.statusCode).toBe(204)
    expect(getSession(db, 's1', Date.now())).toBeNull()
    await app.close()
  })
})
