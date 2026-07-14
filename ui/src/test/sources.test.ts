import { describe, it, expect } from 'vitest'
import { sourceColorIndex } from '../lib/sources'

describe('sourceColorIndex', () => {
  it('pre-seeds webapp=0 and api=1 whenever present', () => {
    const sources = ['webapp', 'api', 'worker']
    expect(sourceColorIndex(sources, 'webapp')).toBe(0)
    expect(sourceColorIndex(sources, 'api')).toBe(1)
    expect(sourceColorIndex(sources, 'worker')).toBe(2)
  })

  it('pre-seeds webapp/api to 0/1 regardless of their order in the input array', () => {
    const sources = ['worker', 'api', 'webapp']
    expect(sourceColorIndex(sources, 'webapp')).toBe(0)
    expect(sourceColorIndex(sources, 'api')).toBe(1)
    expect(sourceColorIndex(sources, 'worker')).toBe(2)
  })

  it('assigns non-seeded sources by first-appearance order when webapp/api are absent', () => {
    const sources = ['worker', 'custom', 'other']
    expect(sourceColorIndex(sources, 'worker')).toBe(0)
    expect(sourceColorIndex(sources, 'custom')).toBe(1)
    expect(sourceColorIndex(sources, 'other')).toBe(2)
  })

  it('only reserves slot 1 for api when api is actually present', () => {
    const sources = ['worker', 'webapp']
    expect(sourceColorIndex(sources, 'webapp')).toBe(0)
    expect(sourceColorIndex(sources, 'worker')).toBe(1)
  })

  it('wraps around after 6 distinct sources', () => {
    const sources = ['webapp', 'api', 's1', 's2', 's3', 's4', 's5']
    expect(sourceColorIndex(sources, 's5')).toBe(0)
  })

  it('stays within 0..5', () => {
    const sources = ['webapp', 'api', 's1', 's2', 's3', 's4', 's5', 's6']
    for (const s of sources) {
      const idx = sourceColorIndex(sources, s)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThanOrEqual(5)
    }
  })
})
