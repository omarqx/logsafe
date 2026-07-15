import { describe, it, expect } from 'vitest'
import { PLUGIN_API_VERSION } from '@coglet/logsafe-plugin-sdk/server'
import type { ServerPlugin, PluginManifest, IncomingEvent } from '@coglet/logsafe-plugin-sdk/server'

describe('server SDK', () => {
  it('exposes the contract version', () => {
    expect(PLUGIN_API_VERSION).toBe('1')
  })

  it('lets a plugin object satisfy the ServerPlugin type', () => {
    const manifest: PluginManifest = {
      id: 'foo', version: '0.0.1', apiVersion: '1', ownedTypes: ['foo'], priority: 5,
    }
    const plugin: ServerPlugin = {
      matchType: (e: IncomingEvent) => (e.source === 'foo' ? 'foo' : null),
    }
    expect(manifest.ownedTypes).toContain('foo')
    expect(plugin.matchType?.({ source: 'foo' } as IncomingEvent)).toBe('foo')
  })
})
