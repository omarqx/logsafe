// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import starterUi from '../../../templates/plugin-starter/ui'
import starterServer from '../../../templates/plugin-starter/server'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import type { SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

const session = (types: string[]): SessionSummary => ({
  id: 's', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle',
  event_count: 0, error_count: 0, warn_count: 0, sources: [], types,
})

describe('plugin-starter template', () => {
  it('compiles against the SDK and resolves for its type', () => {
    expect(starterUi.type).toBe('my-plugin')
    expect(typeof starterServer.matchType).toBe('function')
    const reg = buildRegistry([starterUi])
    expect(resolveViewOwner(session(['my-plugin']), reg)).toBe(starterUi)
  })
})
