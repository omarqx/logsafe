// Confirm+call orchestration for the purge action (the `cleared` chip's
// `purge` affordance, see components/CmdBar.tsx and routes/SessionDetailPage
// .tsx). Extracted as a pure-ish function — injected confirmFn/purgeFn
// rather than reaching for window.confirm/api.purgeEvents directly — so the
// three branches (declined / purged-all / purged) are unit-testable without
// mounting SessionDetailPage (which would otherwise require stubbing
// window.confirm, fetch, and the router just to exercise this logic).
import type { SessionSummary } from '../api'

export interface ConfirmAndPurgeArgs {
  id: string
  floor: number
  confirmFn: (message: string) => boolean
  purgeFn: (id: string, throughSeq: number) => Promise<{ deleted: number; session: SessionSummary | null }>
}

// 'purged-all' vs 'purged' lets the caller decide navigate('/') vs. just
// dropping the `after` floor from the URL (see spec: session: null means
// everything was purged and the session row itself is gone).
export type PurgeOutcome = 'declined' | 'purged-all' | 'purged'

export async function confirmAndPurge({ id, floor, confirmFn, purgeFn }: ConfirmAndPurgeArgs): Promise<PurgeOutcome> {
  const confirmed = confirmFn(`Permanently delete all events up to seq ${floor} in this session? This cannot be undone.`)
  if (!confirmed) return 'declined'
  const result = await purgeFn(id, floor)
  return result.session === null ? 'purged-all' : 'purged'
}
