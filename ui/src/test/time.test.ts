import { describe, it, expect } from 'vitest'
import { formatTs, formatDuration, formatStarted, parseTsMode } from '../lib/time'

function localHHMMSSmmm(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const mmm = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${mmm}`
}

describe('formatTs — abs mode', () => {
  it('formats local HH:MM:SS.mmm', () => {
    const ts = new Date(2026, 0, 1, 9, 5, 3, 42).getTime()
    expect(formatTs('abs', { ts }, ts, null)).toBe(localHHMMSSmmm(ts))
  })
})

describe('formatTs — rel mode', () => {
  const sessionStart = 1_000_000

  it('formats sub-minute elapsed as +SS.mmm, zero-padded', () => {
    expect(formatTs('rel', { ts: sessionStart }, sessionStart, null)).toBe('+00.000')
    expect(formatTs('rel', { ts: sessionStart + 2310 }, sessionStart, null)).toBe('+02.310')
    expect(formatTs('rel', { ts: sessionStart + 10_658 }, sessionStart, null)).toBe('+10.658')
  })

  it('rolls over to +MM:SS.mmm past 60s', () => {
    expect(formatTs('rel', { ts: sessionStart + 60_000 }, sessionStart, null)).toBe('+01:00.000')
    expect(formatTs('rel', { ts: sessionStart + 61_500 }, sessionStart, null)).toBe('+01:01.500')
    expect(formatTs('rel', { ts: sessionStart + 125_004 }, sessionStart, null)).toBe('+02:05.004')
  })
})

describe('formatTs — delta mode', () => {
  it('returns an empty string for the first row (prevTs === null)', () => {
    expect(formatTs('delta', { ts: 1000 }, 1000, null)).toBe('')
  })

  it('formats the gap vs the previous row as +D.DDD seconds', () => {
    expect(formatTs('delta', { ts: 1012 }, 0, 1000)).toBe('+0.012')
    expect(formatTs('delta', { ts: 7632 }, 0, 632)).toBe('+7.000')
  })
})

describe('formatDuration', () => {
  it('formats sub-minute durations as Ns', () => {
    expect(formatDuration(30_000)).toBe('30s')
    expect(formatDuration(5_000)).toBe('5s')
  })

  it('formats sub-hour durations as Nm SSs, seconds zero-padded', () => {
    expect(formatDuration(124_000)).toBe('2m 04s')
    expect(formatDuration(60_000)).toBe('1m 00s')
  })

  it('formats hour+ durations as Nh MMm, minutes zero-padded, no seconds', () => {
    expect(formatDuration(22_320_000)).toBe('6h 12m')
    expect(formatDuration(3_600_000)).toBe('1h 00m')
  })
})

describe('parseTsMode', () => {
  it('accepts the three known modes unchanged', () => {
    expect(parseTsMode('abs')).toBe('abs')
    expect(parseTsMode('rel')).toBe('rel')
    expect(parseTsMode('delta')).toBe('delta')
  })

  it('falls back to "rel" for a missing param', () => {
    expect(parseTsMode(null)).toBe('rel')
  })

  it('falls back to "rel" for an unknown/garbage value instead of rendering blank timestamps', () => {
    expect(parseTsMode('')).toBe('rel')
    expect(parseTsMode('bogus')).toBe('rel')
    expect(parseTsMode('ABS')).toBe('rel')
  })
})

describe('formatStarted', () => {
  it('formats the time as zero-padded local HH:MM:SS', () => {
    const ts = new Date(2026, 6, 13, 9, 5, 3).getTime()
    const now = new Date(2026, 6, 13, 22, 0, 0).getTime()
    expect(formatStarted(ts, now).time).toBe('09:05:03')
  })

  it('labels same local calendar day as "today"', () => {
    const ts = new Date(2026, 6, 13, 0, 0, 1).getTime()
    const now = new Date(2026, 6, 13, 23, 59, 59).getTime()
    expect(formatStarted(ts, now).day).toBe('today')
  })

  it('labels the previous local calendar day as "yesterday"', () => {
    const ts = new Date(2026, 6, 12, 23, 59, 0).getTime()
    const now = new Date(2026, 6, 13, 0, 0, 30).getTime()
    expect(formatStarted(ts, now).day).toBe('yesterday')
  })

  it('labels anything older than yesterday as an abbreviated month + day', () => {
    const ts = new Date(2026, 6, 11, 9, 12, 44).getTime()
    const now = new Date(2026, 6, 13, 22, 58, 41).getTime()
    expect(formatStarted(ts, now).day).toBe('Jul 11')
  })

  it('crosses year/month boundaries correctly for "yesterday"', () => {
    const ts = new Date(2025, 11, 31, 23, 0, 0).getTime() // Dec 31, 2025
    const now = new Date(2026, 0, 1, 0, 30, 0).getTime() // Jan 1, 2026
    expect(formatStarted(ts, now).day).toBe('yesterday')
  })
})
