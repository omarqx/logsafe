export const LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type Level = (typeof LEVELS)[number]

export interface NormalizedEvent {
  session_id: string
  ts: number
  received_at: number
  source: string
  ns: string
  level: Level
  msg: string
  ctx: string | null
  trace: string | null
  session_label: string | null
}

const LEVEL_SET = new Set<string>(LEVELS)

export function scratchSessionId(now: number): string {
  return `scratch-${new Date(now).toISOString().slice(0, 10)}`
}

/** Returns null only for unsalvageable events: not a plain object, or missing/empty msg.
    Everything else is coerced — a log tool must not reject logs it can salvage. */
export function normalizeEvent(raw: unknown, now: number): NormalizedEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.msg === undefined || r.msg === null) return null
  const msg = typeof r.msg === 'string' ? r.msg : JSON.stringify(r.msg) ?? String(r.msg)
  if (msg === '') return null

  let ts = now
  if (typeof r.ts === 'number' && Number.isFinite(r.ts)) ts = Math.trunc(r.ts)
  else if (typeof r.ts === 'string') {
    const parsed = Date.parse(r.ts)
    if (!Number.isNaN(parsed)) ts = parsed
  }

  let level: Level = 'info'
  let coercedLevel: unknown
  if (typeof r.level === 'string' && LEVEL_SET.has(r.level)) level = r.level as Level
  else if (r.level !== undefined) coercedLevel = r.level

  let ctxValue = r.ctx
  if (coercedLevel !== undefined) {
    if (ctxValue !== null && typeof ctxValue === 'object' && !Array.isArray(ctxValue)) {
      ctxValue = { ...(ctxValue as Record<string, unknown>), _level: coercedLevel }
    } else if (ctxValue === undefined) {
      ctxValue = { _level: coercedLevel }
    } else {
      ctxValue = { _level: coercedLevel, value: ctxValue }
    }
  }

  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

  return {
    session_id: str(r.session_id) ?? scratchSessionId(now),
    ts,
    received_at: now,
    source: str(r.source) ?? 'default',
    ns: typeof r.ns === 'string' ? r.ns : '',
    level,
    msg,
    ctx: ctxValue === undefined || ctxValue === null ? null : JSON.stringify(ctxValue),
    trace: str(r.trace),
    session_label: str(r.session_label),
  }
}
