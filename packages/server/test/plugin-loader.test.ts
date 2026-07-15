import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { loadServerPlugins } from '../src/plugins/loader.js'

const FIX = path.join(import.meta.dirname, 'fixtures')

describe('plugin loader', () => {
  it('loads a fixture plugin, runs migrate, and exposes its hooks', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-foo'], FIX)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].manifest.id).toBe('foo')
    expect(typeof loaded[0].plugin.matchType).toBe('function')
    // migrate created the plugin table:
    const tbl = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_foo_marks'`).get())
    expect(tbl).toBeTruthy()
  })

  it('skips a plugin whose apiVersion major does not match', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-foo'], FIX, { apiVersion: '2' })
    expect(loaded).toHaveLength(0)
  })

  it('skips a plugin whose migrate throws, without aborting later plugins', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-boom', './plugin-foo'], FIX)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].manifest.id).toBe('foo')
  })

  it('skips a plugin whose manifest is missing apiVersion', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-noapi'], FIX)
    expect(loaded).toHaveLength(0)
  })

  it('skips a plugin whose manifest is missing ownedTypes', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-notypes'], FIX)
    expect(loaded).toHaveLength(0)
  })

  it('skips a duplicate plugin id loaded from a second specifier', async () => {
    const db = openDb(':memory:')
    const loaded = await loadServerPlugins(db, ['./plugin-foo', './plugin-foo'], FIX)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].manifest.id).toBe('foo')
  })
})
