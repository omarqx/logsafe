// Pure timestamp/duration formatting. No DOM, no fetch, no react.

export type TsMode = 'abs' | 'rel' | 'delta'

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function formatAbs(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`
}

function formatRel(elapsedMs: number): string {
  const ms = Math.max(0, Math.round(elapsedMs))
  const totalSec = Math.floor(ms / 1000)
  const mmm = pad(ms % 1000, 3)
  if (totalSec < 60) {
    return `+${pad(totalSec, 2)}.${mmm}`
  }
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `+${pad(min, 2)}:${pad(sec, 2)}.${mmm}`
}

function formatDelta(deltaMs: number): string {
  const sign = deltaMs < 0 ? '-' : '+'
  return `${sign}${(Math.abs(deltaMs) / 1000).toFixed(3)}`
}

/**
 * abs   -> local 'HH:MM:SS.mmm'
 * rel   -> elapsed since sessionStart, '+SS.mmm' under a minute, '+MM:SS.mmm' past it
 * delta -> gap vs the previous row, '+D.DDD' seconds; '' for the first row (prevTs === null)
 */
export function formatTs(mode: TsMode, ev: { ts: number }, sessionStart: number, prevTs: number | null): string {
  switch (mode) {
    case 'abs':
      return formatAbs(ev.ts)
    case 'rel':
      return formatRel(ev.ts - sessionStart)
    case 'delta':
      return prevTs === null ? '' : formatDelta(ev.ts - prevTs)
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface StartedLabel {
  time: string
  day: string
}

/**
 * Formats a session's `first_ts` for the list view: local 'HH:MM:SS' plus a
 * relative day word — 'today' or 'yesterday' for the local calendar day
 * relative to `now`, otherwise an abbreviated 'Mon D' date.
 */
export function formatStarted(ts: number, now: number): StartedLabel {
  const d = new Date(ts)
  const n = new Date(now)
  const time = `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`

  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const nDay = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
  const diffDays = Math.round((nDay - dDay) / 86_400_000)

  let day: string
  if (diffDays === 0) {
    day = 'today'
  } else if (diffDays === 1) {
    day = 'yesterday'
  } else {
    day = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  }

  return { time, day }
}

/** '30s' under a minute, '2m 04s' under an hour, '6h 12m' at an hour or beyond. */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) {
    return `${totalSec}s`
  }
  const totalMin = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  if (totalMin < 60) {
    return `${totalMin}m ${pad(secs, 2)}s`
  }
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return `${hours}h ${pad(mins, 2)}m`
}
