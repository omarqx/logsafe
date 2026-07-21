// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { UIPlugin } from '@coglet/logsafe-plugin-sdk/ui'

// Mock the generated registry BEFORE importing the pages.
vi.mock('../plugins.generated', () => {
  const hello: UIPlugin = {
    type: 'hello',
    ListRow: ({ session }) => <div>ROW:{session.id}</div>,
    DetailView: ({ sessionId }) => <div>DETAIL:{sessionId}</div>,
  }
  // A plugin whose manifest id differs from its owned type: pluginFetch must
  // be scoped by the ID (routes mount at /api/plugins/<id>/), not the type.
  const metrics: UIPlugin = {
    id: 'metrics-pro',
    type: 'metrics',
    ListRow: ({ session, pluginFetch }) => {
      void pluginFetch('/ping').catch(() => {})
      return <div>MROW:{session.id}</div>
    },
  }
  return { uiPlugins: [hello, metrics] }
})

import { SessionListPage } from '../routes/SessionListPage'
import { SessionDetailPage } from '../routes/SessionDetailPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const sess = (id: string, types: string[]) => ({ id, label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 0, error_count: 0, warn_count: 0, sources: [], types })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/sessions')) return { ok: true, status: 200, json: async () => [sess('s1', ['hello']), sess('s2', ['metrics'])] }
    if (url.match(/\/api\/sessions\/s1$/)) return { ok: true, status: 200, json: async () => sess('s1', ['hello']) }
    return { ok: true, status: 200, json: async () => ({ events: [], next_after_seq: null }) }
  })
  vi.stubGlobal('fetch', fetchMock as never)
})

it('list uses the plugin ListRow for an owned session', async () => {
  render(<MemoryRouter><SessionListPage /></MemoryRouter>)
  expect(await screen.findByText('ROW:s1')).toBeTruthy()
})

it('detail renders the plugin DetailView for an owned session', async () => {
  render(<MemoryRouter initialEntries={['/s/s1']}><Routes><Route path="/s/:id" element={<SessionDetailPage />} /></Routes></MemoryRouter>)
  expect(await screen.findByText('DETAIL:s1')).toBeTruthy()
})

it('pluginFetch handed to plugin components is scoped by plugin ID, not type', async () => {
  render(<MemoryRouter><SessionListPage /></MemoryRouter>)
  expect(await screen.findByText('MROW:s2')).toBeTruthy()
  const urls = fetchMock.mock.calls.map((c) => String(c[0]))
  expect(urls).toContain('/api/plugins/metrics-pro/ping') // manifest id
  expect(urls.some((u) => u.startsWith('/api/plugins/metrics/'))).toBe(false) // never the type
})
