// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  LogsafeRuntimeProvider, FlatLogView, useCoreApi,
  type LogsafeRuntime,
} from '@coglet/logsafe-plugin-sdk/ui'

afterEach(cleanup)

function runtime(over: Partial<LogsafeRuntime> = {}): LogsafeRuntime {
  return {
    api: { fetchEventsPage: async () => ({ events: [], next_after_seq: null }), getSession: async () => null, exportUrl: () => '' },
    makePluginFetch: () => (async () => ({})) as never,
    FlatLogView: () => <div>REAL-FLAT</div>,
    useSessionEvents: () => ({ events: [], loading: false, tail: 'live', pause() {}, resume() {}, error: null }),
    tokens: {} as never,
    ...over,
  }
}

describe('ui SDK runtime', () => {
  it('delegates FlatLogView to the core-provided implementation', () => {
    render(
      <LogsafeRuntimeProvider value={runtime()}>
        <FlatLogView sessionId="s1" session={null} />
      </LogsafeRuntimeProvider>,
    )
    expect(screen.getByText('REAL-FLAT')).toBeTruthy()
  })

  it('throws a clear error when a facade is used with no provider', () => {
    function Probe() { useCoreApi(); return null }
    expect(() => render(<Probe />)).toThrow(/LogsafeRuntimeProvider/)
  })
})
