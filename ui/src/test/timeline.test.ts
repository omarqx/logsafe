import { describe, it, expect } from 'vitest'
import { layoutTimeline, barColor, MAX_TIMELINE_ROWS } from '../../../examples/plugin-http/timeline'

const req = (trace: string, ts: number, latency_ms: number | null, status: number | null) => ({
  session_id: 's1', trace, method: 'GET', path: '/', status, latency_ms, ts,
})
const TOKENS = { phos: 'PHOS', amber: 'AMBER', err: 'ERR' }

describe('layoutTimeline', () => {
  it('maps ts to x across the span and latency to width', () => {
    const rows = layoutTimeline([req('a', 1000, 100, 200), req('b', 3000, 200, 200)], { width: 600, axisStart: 100 })
    expect(rows[0].x).toBe(100)                    // first request at axis start
    expect(rows[1].x).toBe(600)                    // last request at the right edge
    expect(rows[1].width).toBeGreaterThan(rows[0].width) // width ∝ latency
  })

  it('single request centers on the axis without dividing by zero', () => {
    const rows = layoutTimeline([req('a', 1000, 100, 200)], { width: 600, axisStart: 100 })
    expect(Number.isFinite(rows[0].x)).toBe(true)
  })

  it('enforces the 2px minimum bar width (null latency included)', () => {
    const rows = layoutTimeline([req('a', 1000, 0, 200), req('b', 2000, null, 200)], { width: 600, axisStart: 100 })
    expect(rows[0].width).toBeGreaterThanOrEqual(2)
    expect(rows[1].width).toBeGreaterThanOrEqual(2)
  })

  it('caps rows at MAX_TIMELINE_ROWS keeping the newest', () => {
    const many = Array.from({ length: 50 }, (_, i) => req(`t${i}`, 1000 + i, 10, 200))
    const rows = layoutTimeline(many, { width: 600, axisStart: 100 })
    expect(rows).toHaveLength(MAX_TIMELINE_ROWS)
    expect(rows[rows.length - 1].request.trace).toBe('t49') // newest kept
  })
})

describe('barColor', () => {
  it('status buckets: ok -> phos, slow/4xx -> amber, 5xx -> err', () => {
    expect(barColor(req('a', 0, 100, 200), TOKENS as never)).toBe('PHOS')
    expect(barColor(req('a', 0, 100, 404), TOKENS as never)).toBe('AMBER')
    expect(barColor(req('a', 0, 1500, 200), TOKENS as never)).toBe('AMBER') // slow
    expect(barColor(req('a', 0, 100, 500), TOKENS as never)).toBe('ERR')
  })
})
