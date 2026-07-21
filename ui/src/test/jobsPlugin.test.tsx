// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import jobsUi from '../../../examples/plugin-jobs/ui'
import { buildRegistry, resolveViewOwner } from '../plugins/registry'
import { LogsafeRuntimeProvider, type LogsafeRuntime, type SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const session = (types: string[]): SessionSummary => ({
  id: 's1', label: 'jobs demo', first_ts: 0, last_ts: 9000, duration_ms: 9000, status: 'idle',
  event_count: 6, error_count: 0, warn_count: 0, sources: ['worker'], types,
})

const SUMMARY = { processed: 3, running: 1, failed: 1, failure_rate_pct: 33, avg_duration_ms: 480, max_duration_ms: 1200 }
const RUNS = {
  runs: [
    { session_id: 's1', job_id: 'j1', name: 'resize', status: 'done',   duration_ms: 140,  ts: 1000 },
    { session_id: 's1', job_id: 'j2', name: 'resize', status: 'failed', duration_ms: 1200, ts: 2000 },
    { session_id: 's1', job_id: 'j3', name: 'email',  status: 'done',   duration_ms: 100,  ts: 3000 },
  ],
}

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
const pluginFetch = vi.fn(async (path: string) => (path.startsWith('/durations') ? RUNS : SUMMARY))

function renderDetail() {
  const Detail = jobsUi.DetailView!
  return render(
    <LogsafeRuntimeProvider value={runtime}>
      <Detail session={session(['generic', 'job'])} sessionId="s1" api={runtime.api}
        pluginFetch={pluginFetch as never}
        urlState={{ params: new URLSearchParams(), setParams: vi.fn() }} tokens={TOKENS} />
    </LogsafeRuntimeProvider>,
  )
}

describe('plugin-jobs UI', () => {
  it('conforms to the contract and resolves for job sessions', () => {
    expect(jobsUi.type).toBe('job')
    expect(jobsUi.id).toBe('jobs') // routes mount by id — pluginFetch must be scoped by it
    const reg = buildRegistry([jobsUi])
    expect(resolveViewOwner(session(['generic', 'job']), reg)).toBe(jobsUi)
    expect(resolveViewOwner(session(['generic']), reg)).toBeUndefined()
  })

  it('renders the four stat cards with summary values and composes the flat log', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('PROCESSED')).toBeTruthy())
    expect(screen.getByText('3')).toBeTruthy()          // processed
    expect(screen.getByText('33%')).toBeTruthy()        // failed %
    expect(screen.getByText(/480/)).toBeTruthy()        // avg dur
    expect(screen.getByText(/1200|1\.2/)).toBeTruthy()  // max dur
    expect(screen.getByText('FLAT-LOG-STUB')).toBeTruthy()
  })

  it('renders the sparkline with one marker per completed run, failure in err color', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getAllByTestId('spark-point')).toHaveLength(3))
    const failed = screen.getAllByTestId('spark-point').find((el) => el.getAttribute('fill') === 'var(--err)')
    expect(failed).toBeTruthy()
  })
})
