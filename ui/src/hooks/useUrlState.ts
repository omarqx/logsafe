// Thin wrapper over react-router's useSearchParams. The URL is the single
// source of truth for shareable view state (filters, ts mode, pin, sel —
// see lib/filters.ts); this hook is the one place components touch
// react-router to read/write it, so later code never imports
// react-router-dom directly just to get at URLSearchParams.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface UrlStateApi {
  /**
   * Current URL search params. react-router memoizes this by
   * `location.search`, so it keeps referential identity across re-renders
   * that don't change the URL — callers can safely depend on it in
   * `useMemo`/`useCallback` (e.g. SessionDetailPage's
   * `useMemo(() => filtersFromSearch(params), [params])`) without those
   * recomputing on every unrelated re-render. See useUrlState.test.tsx for
   * the pinned-down behavior of the installed react-router version.
   */
  params: URLSearchParams
  /**
   * Replace the URL search params. Defaults to `replace: true` (no new
   * history entry) since most writes here are incremental filter edits;
   * pass `{ replace: false }` for state that should be back-button-able.
   */
  setParams(next: URLSearchParams, opts?: { replace?: boolean }): void
}

export function useUrlState(): UrlStateApi {
  const [params, setSearchParams] = useSearchParams()

  const setParams = useCallback(
    (next: URLSearchParams, opts?: { replace?: boolean }) => {
      setSearchParams(next, { replace: opts?.replace ?? true })
    },
    [setSearchParams],
  )

  return { params, setParams }
}
