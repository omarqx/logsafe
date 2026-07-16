// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { logsafeRuntime } from '../runtime'

describe('logsafeRuntime', () => {
  it('exposes the core api and a scoped pluginFetch factory', () => {
    expect(typeof logsafeRuntime.api.getSession).toBe('function')
    expect(typeof logsafeRuntime.makePluginFetch('psdk')).toBe('function')
    expect(typeof logsafeRuntime.FlatLogView).toBe('function')
    expect(logsafeRuntime.tokens.phos).toBe('var(--phos)')
  })
})
