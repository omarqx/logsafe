// @vitest-environment jsdom
// Component-level coverage for the modifier-key guard (item 2): a
// Cmd/Ctrl/Alt-held 'j' must not be intercepted as the "move selection
// down" shortcut, so browser shortcuts like Cmd+F still work in this view.
// See lib/keyboard.test.ts for the underlying predicate's own unit tests.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionListPage } from '../routes/SessionListPage'
import type { SessionSummary } from '../api'

afterEach(cleanup)

const fetchMock = vi.fn()

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1',
    label: 'checkout flow',
    first_ts: 0,
    last_ts: 1000,
    duration_ms: 1000,
    status: 'idle',
    event_count: 10,
    error_count: 0,
    warn_count: 0,
    sources: ['webapp'],
    types: [],
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SessionListPage: modifier-key guard', () => {
  it('does not move the selection when j is pressed with a modifier key held', async () => {
    const sessions = [session({ id: 's1' }), session({ id: 's2' })]
    fetchMock.mockResolvedValue(jsonResponse(sessions))

    const { container } = render(
      <MemoryRouter>
        <SessionListPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(container.querySelector('.row.selected')).not.toBeNull())
    const selectedId = () => container.querySelector('.row.selected')?.textContent

    const before = selectedId()
    expect(before).toContain('s1') // defaults to the first row

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }))
    })
    expect(selectedId()).toBe(before) // unchanged — the browser shortcut, not ours, should get this key

    // Sanity: the same key without a modifier does move the selection,
    // proving the guard (not something else) suppressed the case above.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    })
    expect(selectedId()).not.toBe(before)
    expect(selectedId()).toContain('s2')
  })
})
