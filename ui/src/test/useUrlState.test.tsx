// @vitest-environment jsdom
//
// Covers the "unmemoized filters defeats LogRow memoization" fix in
// SessionDetailPage.tsx: `filters = useMemo(() => filtersFromSearch(params), [params])`.
// SessionDetailPage itself isn't rendered here (that needs router param
// matching + SSE/fetch mocking + @tanstack/react-virtual, which needs
// ResizeObserver support this project's jsdom setup doesn't provide —
// building that harness from scratch risks exactly the kind of flaky
// scroll-dependent test the task brief calls out to avoid). Instead this
// exercises the two real building blocks the fix depends on, using the
// actual useUrlState hook and react-router's actual MemoryRouter (no
// timers, no async, no scroll — deterministic):
//
//   1. react-router's useSearchParams memoizes its returned URLSearchParams
//      by location.search, so `params` keeps referential identity across
//      re-renders that don't change the URL (see useUrlState.ts's own
//      comment claiming otherwise — this test pins down the actual
//      behavior of the installed react-router version).
//   2. Given that stable `params`, `useMemo(() => filtersFromSearch(params),
//      [params])` — the exact pattern SessionDetailPage now uses — also
//      stays referentially stable, which is what let LogRow's
//      `React.memo` skip re-rendering rows again.
//
// The keyboard-pause-on-navigation fix (Finding 2) is scroll/DOM-layout
// dependent and is covered by manual verification only, per Task 8 — see
// the fix report for what was checked by hand.
import { useMemo } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useUrlState } from '../hooks/useUrlState'
import { filtersFromSearch, type Filters } from '../lib/filters'

afterEach(cleanup)

// Note: react-router's <MemoryRouter> creates its history once (a useRef)
// and ignores `initialEntries` on subsequent renders of the same element —
// so `rerender(...)` below with an unchanged URL is a faithful stand-in for
// "parent re-rendered, URL didn't change" (e.g. a new SSE event/poll tick
// in SessionDetailPage), and the real URL transition in the third test is
// driven through the hook's own `setParams`, exactly as SessionDetailPage
// does it.

describe('useUrlState + memoized filters (SessionDetailPage fix)', () => {
  it('keeps `params` referentially stable across re-renders that do not change the URL', () => {
    const seenParams: URLSearchParams[] = []

    function Probe() {
      const { params } = useUrlState()
      seenParams.push(params)
      return null
    }

    const { rerender } = render(
      <MemoryRouter initialEntries={['/s/abc?level=error']}>
        <Probe />
      </MemoryRouter>,
    )

    // Simulate a parent re-render that has nothing to do with the URL —
    // e.g. SessionDetailPage re-rendering because a new SSE event arrived
    // (state.events changed) or the 5s session-summary poll ticked.
    rerender(
      <MemoryRouter initialEntries={['/s/abc?level=error']}>
        <Probe />
      </MemoryRouter>,
    )

    expect(seenParams).toHaveLength(2)
    expect(seenParams[1]).toBe(seenParams[0])
  })

  it('mirrors the SessionDetailPage fix: useMemo(filtersFromSearch, [params]) stays stable across unrelated re-renders', () => {
    const seenFilters: Filters[] = []

    function Probe({ tick }: { tick: number }) {
      const { params } = useUrlState()
      const filters = useMemo(() => filtersFromSearch(params), [params])
      seenFilters.push(filters)
      return <span>{tick}</span>
    }

    const { rerender } = render(
      <MemoryRouter initialEntries={['/s/abc?level=error&ns=auth']}>
        <Probe tick={0} />
      </MemoryRouter>,
    )

    rerender(
      <MemoryRouter initialEntries={['/s/abc?level=error&ns=auth']}>
        <Probe tick={1} />
      </MemoryRouter>,
    )

    expect(seenFilters).toHaveLength(2)
    expect(seenFilters[0]).toEqual({ level: 'error', ns: 'auth' })
    // The identity check is the actual regression guard: a callback like
    // handleTraceClick built with `[filters, updateFilters]` deps only
    // stays stable — and only lets LogRow's React.memo skip re-rendering —
    // if this holds.
    expect(seenFilters[1]).toBe(seenFilters[0])
  })

  it('recomputes filters (new identity) when the URL search actually changes', () => {
    const seenFilters: Filters[] = []

    function Probe() {
      const { params, setParams } = useUrlState()
      const filters = useMemo(() => filtersFromSearch(params), [params])
      seenFilters.push(filters)
      return (
        <button
          onClick={() => {
            const next = new URLSearchParams(params)
            next.set('level', 'warn')
            setParams(next, { replace: true })
          }}
        >
          navigate
        </button>
      )
    }

    const { getByText } = render(
      <MemoryRouter initialEntries={['/s/abc?level=error']}>
        <Probe />
      </MemoryRouter>,
    )

    expect(seenFilters[0]).toEqual({ level: 'error' })

    fireEvent.click(getByText('navigate'))

    const last = seenFilters[seenFilters.length - 1]
    expect(last).toEqual({ level: 'warn' })
    expect(last).not.toBe(seenFilters[0])
  })
})
