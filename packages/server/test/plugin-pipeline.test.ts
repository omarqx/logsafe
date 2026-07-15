import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'
import { buildApp } from '../src/app.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('ingest pipeline with plugins', () => {
  it('classifies via matchType and records afterInsert side effects', async () => {
    const db = openDb(':memory:')
    const plugins = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    const app = buildApp({ db, plugins })

    const res = await app.inject({
      method: 'POST', url: '/v1/log',
      payload: [{ msg: 'x', session_id: 's1', source: 'foo' }, { msg: 'y', session_id: 's1', source: 'web' }],
    })
    expect(res.statusCode).toBe(202)

    const events = await app.inject({ method: 'GET', url: '/api/sessions/s1/events' })
    const byMsg = Object.fromEntries((events.json().events as { msg: string; type: string }[]).map((e) => [e.msg, e.type]))
    expect(byMsg.x).toBe('foo')      // matched
    expect(byMsg.y).toBe('generic')  // unmatched → fallback

    const marks = db.prepare(`SELECT COUNT(*) c FROM plugin_foo_marks`).get() as { c: number }
    expect(marks.c).toBe(1) // afterInsert only received the 'foo'-typed event
    await app.close()
  })
})
