// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import helloUi from '../../../examples/plugin-hello/ui'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import type { SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

const session = (types: string[]): SessionSummary => ({ id: 's', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 3, error_count: 0, warn_count: 0, sources: [], types })

describe('hello plugin against the real contract', () => {
  it('is a valid UIPlugin resolved for a hello-typed session', () => {
    expect(helloUi.type).toBe('hello')
    const reg = buildRegistry([helloUi])
    expect(resolveViewOwner(session(['generic', 'hello']), reg)).toBe(helloUi)
    expect(resolveViewOwner(session(['generic']), reg)).toBeUndefined()
  })
})
