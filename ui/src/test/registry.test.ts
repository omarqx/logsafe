import { describe, it, expect } from 'vitest'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import type { UIPlugin, SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

function s(types: string[]): SessionSummary {
  return { id: 's', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 0, error_count: 0, warn_count: 0, sources: [], types }
}

describe('resolveViewOwner', () => {
  const psdk: UIPlugin = { type: 'psdk' }
  const reg = buildRegistry([psdk])
  it('picks the plugin whose type appears in the session', () => {
    expect(resolveViewOwner(s(['generic', 'psdk']), reg)).toBe(psdk)
  })
  it('returns undefined when no installed plugin matches', () => {
    expect(resolveViewOwner(s(['generic']), reg)).toBeUndefined()
    expect(resolveViewOwner(s(['unknown']), reg)).toBeUndefined()
  })
})
