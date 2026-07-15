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
  return { uiPlugins: [hello] }
})

import { SessionListPage } from '../routes/SessionListPage'
import { SessionDetailPage } from '../routes/SessionDetailPage'

afterEach(cleanup)
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/api/sessions')) return { ok: true, status: 200, json: async () => [{ id: 's1', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 0, error_count: 0, warn_count: 0, sources: [], types: ['hello'] }] }
    if (url.match(/\/api\/sessions\/s1$/)) return { ok: true, status: 200, json: async () => ({ id: 's1', label: null, first_ts: 0, last_ts: 0, duration_ms: 0, status: 'idle', event_count: 0, error_count: 0, warn_count: 0, sources: [], types: ['hello'] }) }
    return { ok: true, status: 200, json: async () => ({ events: [], next_after_seq: null }) }
  }) as never)
})

it('list uses the plugin ListRow for an owned session', async () => {
  render(<MemoryRouter><SessionListPage /></MemoryRouter>)
  expect(await screen.findByText('ROW:s1')).toBeTruthy()
})

it('detail renders the plugin DetailView for an owned session', async () => {
  render(<MemoryRouter initialEntries={['/s/s1']}><Routes><Route path="/s/:id" element={<SessionDetailPage />} /></Routes></MemoryRouter>)
  expect(await screen.findByText('DETAIL:s1')).toBeTruthy()
})
