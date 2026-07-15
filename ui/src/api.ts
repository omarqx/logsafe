// Thin HTTP client for the logsafe contract in API.md. Relative URLs so the
// Vite dev proxy and the production same-origin static bundle both work
// unmodified.

export interface SessionSummary {
  id: string
  label: string | null
  first_ts: number
  last_ts: number
  duration_ms: number
  status: 'active' | 'idle'
  event_count: number
  error_count: number
  warn_count: number
  sources: string[]
}

export interface StoredEvent {
  seq: number
  session_id: string
  ts: number
  received_at: number
  source: string
  ns: string
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  ctx: unknown
  trace: string | null
}

export interface EventsPage {
  events: StoredEvent[]
  next_after_seq: number | null
}

async function assertOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) {
    throw new Error(`${what} failed: ${res.status}`)
  }
  return res
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch('/api/sessions')
  await assertOk(res, 'listSessions')
  return res.json() as Promise<SessionSummary[]>
}

/** Returns null on 404 rather than throwing. */
export async function getSession(id: string): Promise<SessionSummary | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  await assertOk(res, 'getSession')
  return res.json() as Promise<SessionSummary>
}

/** Idempotent: a 404 (already deleted) is treated as success, not an error. */
export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (res.status === 404) return
  await assertOk(res, 'deleteSession')
}

/**
 * Permanently deletes every event with `seq <= throughSeq` (inclusive) and
 * returns the recomputed session summary, or `session: null` if nothing
 * survived (the session row itself was removed). No idempotent-404 handling
 * like deleteSession — a purge that 404s means the caller's floor no longer
 * makes sense (session already gone), which is a real error to surface.
 */
export async function purgeEvents(id: string, throughSeq: number): Promise<{ deleted: number; session: SessionSummary | null }> {
  const sp = new URLSearchParams({ through_seq: String(throughSeq) })
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/events?${sp.toString()}`, { method: 'DELETE' })
  await assertOk(res, 'purgeEvents')
  return res.json() as Promise<{ deleted: number; session: SessionSummary | null }>
}

export async function fetchEventsPage(
  id: string,
  params: URLSearchParams,
  afterSeq?: number,
  limit?: number,
): Promise<EventsPage> {
  const sp = new URLSearchParams(params)
  if (afterSeq !== undefined) sp.set('after_seq', String(afterSeq))
  if (limit !== undefined) sp.set('limit', String(limit))
  const qs = sp.toString()
  const url = `/api/sessions/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ''}`
  const res = await fetch(url)
  await assertOk(res, 'fetchEventsPage')
  return res.json() as Promise<EventsPage>
}
