// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import httpUi from '../../../examples/plugin-http/ui'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import { LogsafeRuntimeProvider, type LogsafeRuntime, type SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

afterEach(cleanup)

const session = (types: string[]): SessionSummary => ({
  id: 's1', label: 'demo', first_ts: 0, last_ts: 5000, duration_ms: 5000, status: 'idle',
  event_count: 3, error_count: 0, warn_count: 0, sources: ['web'], types,
})

const REQUESTS = {
  requests: [
    { session_id: 's1', trace: 't1', method: 'GET',  path: '/',     status: 200, latency_ms: 120,  ts: 1000 },
    { session_id: 's1', trace: 't2', method: 'POST', path: '/vote', status: 200, latency_ms: 1500, ts: 2000 },
    { session_id: 's1', trace: 't3', method: 'POST', path: '/vote', status: 500, latency_ms: 88,   ts: 3000 },
  ],
}
const SUMMARY = { request_count: 3, error_count: 1, avg_latency_ms: 569, max_latency_ms: 1500 }

const TOKENS = {
  bg: 'var(--bg)', bgRaise: 'var(--bg-raise)', txt: 'var(--txt)', dim: 'var(--dim)', faint: 'var(--faint)',
  line: 'var(--line)', phos: 'var(--phos)', amber: 'var(--amber)', err: 'var(--err)', rowH: '20px', sources: [],
}
const runtime: LogsafeRuntime = {
  api: { fetchEventsPage: async () => ({ events: [], next_after_seq: null }), getSession: async () => null, exportUrl: () => '' },
  makePluginFetch: () => (async () => ({})) as never,
  FlatLogView: () => <div>FLAT-LOG-STUB</div>,
  useSessionEvents: () => ({ events: [], loading: false, tail: 'live', pause() {}, resume() {}, error: null }),
  tokens: TOKENS,
}

const pluginFetch = vi.fn(async (path: string) => (path.startsWith('/requests') ? REQUESTS : SUMMARY))
const setParams = vi.fn()

beforeEach(() => {
  pluginFetch.mockClear()
  setParams.mockClear()
})

function renderDetail() {
  const Detail = httpUi.DetailView!
  return render(
    <LogsafeRuntimeProvider value={runtime}>
      <Detail
        session={session(['generic', 'http'])} sessionId="s1"
        api={runtime.api} pluginFetch={pluginFetch as never}
        urlState={{ params: new URLSearchParams(), setParams }}
        tokens={TOKENS}
      />
    </LogsafeRuntimeProvider>,
  )
}

describe('plugin-http UI', () => {
  it('conforms to the contract and is resolved for http sessions', () => {
    expect(httpUi.type).toBe('http')
    const reg = buildRegistry([httpUi])
    expect(resolveViewOwner(session(['generic', 'http']), reg)).toBe(httpUi)
    expect(resolveViewOwner(session(['generic']), reg)).toBeUndefined()
  })

  it('detail view renders one timeline bar per request and composes the flat log', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getAllByTestId('timeline-bar')).toHaveLength(3))
    expect(screen.getByText('FLAT-LOG-STUB')).toBeTruthy()   // composed FlatLogView
    expect(screen.getByText(/3 reqs/)).toBeTruthy()           // summary strip
  })

  it('clicking a bar sets the trace filter through urlState', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getAllByTestId('timeline-bar')).toHaveLength(3))
    fireEvent.click(screen.getAllByTestId('timeline-bar')[1])
    expect(setParams).toHaveBeenCalled()
    const next = setParams.mock.calls[0][0] as URLSearchParams
    expect(next.get('trace')).toBe('t2')
  })
})
