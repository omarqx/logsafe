import { describe, it, expect } from 'vitest'
import { layoutSparkline, pointColor, MAX_SPARKLINE_POINTS } from '../../../examples/plugin-jobs/sparkline'

const run = (job_id: string, ts: number, duration_ms: number, status = 'done') => ({
  session_id: 's', job_id, name: 'n', status: status as 'done' | 'failed', duration_ms, ts,
})
const TOKENS = { phos: 'PHOS', amber: 'AMBER', err: 'ERR' }
const OPTS = { width: 600, height: 60 }

describe('layoutSparkline', () => {
  it('maps ts to x across the span and duration to y (taller = higher)', () => {
    const pts = layoutSparkline([run('a', 1000, 100), run('b', 3000, 400)], OPTS)
    expect(pts[0].x).toBe(0)
    expect(pts[1].x).toBe(600)
    expect(pts[1].y).toBeLessThan(pts[0].y) // longer duration sits higher (smaller y)
    expect(pts.every((p) => p.y >= 0 && p.y <= 60)).toBe(true)
  })

  it('is safe for a single point (no /0)', () => {
    const pts = layoutSparkline([run('a', 1000, 100)], OPTS)
    expect(Number.isFinite(pts[0].x)).toBe(true)
    expect(Number.isFinite(pts[0].y)).toBe(true)
  })

  it('caps at MAX_SPARKLINE_POINTS keeping the newest', () => {
    const many = Array.from({ length: 150 }, (_, i) => run(`j${i}`, 1000 + i, 10))
    const pts = layoutSparkline(many, OPTS)
    expect(pts).toHaveLength(MAX_SPARKLINE_POINTS)
    expect(pts[pts.length - 1].run.job_id).toBe('j149')
  })
})

describe('pointColor', () => {
  it('failed -> err, slow -> amber, else phos', () => {
    expect(pointColor(run('a', 0, 100, 'failed'), TOKENS as never)).toBe('ERR')
    expect(pointColor(run('a', 0, 1500), TOKENS as never)).toBe('AMBER')
    expect(pointColor(run('a', 0, 100), TOKENS as never)).toBe('PHOS')
  })
})
