import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'
import { buildApp } from '../src/app.js'
import { makePluginContext } from '../src/plugins/context.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('plugin routes', () => {
  it('mounts a plugin GET under /api/plugins/<id>/', async () => {
    const db = openDb(':memory:')
    const plugins = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    const app = buildApp({ db, plugins })
    const res = await app.inject({ method: 'GET', url: '/api/plugins/foo/marks/s1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ session: 's1' })
    await app.close()
  })

  it('normalizes routes registered without a leading slash', async () => {
    const db = openDb(':memory:')
    const testPlugin = {
      manifest: { id: 'test-slash', version: '0', apiVersion: '1', ownedTypes: [] },
      plugin: {
        routes: (r: any) => {
          r.get('noslash/:x', (req: any) => ({ x: req.params.x }))
        },
      },
      ctx: makePluginContext(db, 'test-slash'),
    }
    const app = buildApp({ db, plugins: [testPlugin] })
    const res = await app.inject({ method: 'GET', url: '/api/plugins/test-slash/noslash/hi' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ x: 'hi' })
    await app.close()
  })
})
