import type { Db } from './db.js'

const DAY_MS = 86_400_000

/** Deletes whole sessions (never partial) whose last event is older than the
    cutoff. Returns the number of sessions removed. */
export function pruneSessions(db: Db, retentionDays: number, now: number): number {
  if (retentionDays <= 0) return 0
  const cutoff = now - retentionDays * DAY_MS
  const ids = (db.prepare('SELECT id FROM sessions WHERE last_ts < ?').all(cutoff) as { id: string }[]).map(
    (r) => r.id,
  )
  if (ids.length === 0) return 0
  const run = db.transaction((sids: string[]) => {
    const delEvents = db.prepare('DELETE FROM events WHERE session_id = ?')
    const delSession = db.prepare('DELETE FROM sessions WHERE id = ?')
    for (const sid of sids) {
      delEvents.run(sid)
      delSession.run(sid)
    }
  })
  run(ids)
  return ids.length
}
