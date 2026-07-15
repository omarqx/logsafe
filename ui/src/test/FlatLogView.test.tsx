// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FlatLogView } from '../components/FlatLogView'
import { _setEventSourceFactoryForTests } from '../hooks/useEventStream'
import type { SessionSummary } from '../api'

afterEach(cleanup)

// jsdom has no EventSource; useEventStream opens one for the live tail as
// soon as the initial page load resolves (see useEventStream.ts), which
// would otherwise throw synchronously and surface as a load error instead
// of the events rendering. A no-op stub is enough here — this test only
// checks the initial page render, not live-tail behavior (that's covered by
// useEventStream.test.ts's FakeEventSource).
class NoopEventSource {
  onerror: ((ev: Event) => void) | null = null
  addEventListener(): void {}
  close(): void {}
}
_setEventSourceFactoryForTests(() => new NoopEventSource() as unknown as EventSource)

// jsdom never lays elements out, so offsetHeight/offsetWidth are always 0.
// @tanstack/react-virtual treats a 0 viewport size as "nothing to render"
// (see calculateRange in virtual-core) and returns zero virtual items no
// matter how many rows exist — a standard jsdom + virtualized-list testing
// workaround is to stub a non-zero size so the range calculation actually
// produces rows to assert on.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })

const session: SessionSummary = {
  id: 's1', label: 'x', first_ts: 0, last_ts: 1, duration_ms: 1, status: 'idle',
  event_count: 1, error_count: 0, warn_count: 0, sources: ['web'], types: ['generic'],
}

it('renders the flat stream for a session', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/events')) return { ok: true, status: 200, json: async () => ({ events: [{ seq: 1, session_id: 's1', ts: 0, received_at: 0, source: 'web', ns: '', level: 'info', msg: 'hello-flat', ctx: null, trace: null, type: 'generic' }], next_after_seq: null }) }
    return { ok: true, status: 200, json: async () => session }
  }) as never)
  render(<MemoryRouter initialEntries={['/s/s1']}><FlatLogView sessionId="s1" session={session} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('hello-flat')).toBeTruthy())
})
