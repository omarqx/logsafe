import { describe, it, expect } from 'vitest'
import { binEvents } from '../lib/minimap'

describe('binEvents', () => {
  it('returns empty bins and errors for an empty event list', () => {
    expect(binEvents([], 10)).toEqual({ bins: [], errors: [] })
  })

  it('distributes events across bins by ts, skipping empty bins', () => {
    const events = [
      { ts: 0, level: 'info' },
      { ts: 0, level: 'info' },
      { ts: 1000, level: 'info' },
    ]
    const { bins } = binEvents(events, 10)
    // ts=0 events land in bin 0 (top 0%), ts=1000 (max) lands in the last bin.
    expect(bins[0]).toEqual({ top: 0, height: 10, intensity: 1 })
    const lastBin = bins[bins.length - 1]
    expect(lastBin.top).toBe(90)
    expect(lastBin.height).toBe(10)
    expect(lastBin.intensity).toBe(0.5) // 1 event vs bin-0's 2 events
    expect(bins).toHaveLength(2) // only the two populated bins are returned
  })

  it('normalizes intensity 0..1 relative to the densest bin', () => {
    const events = [
      { ts: 0, level: 'info' },
      { ts: 0, level: 'info' },
      { ts: 0, level: 'info' },
      { ts: 0, level: 'info' },
      { ts: 100, level: 'info' },
      { ts: 100, level: 'info' },
    ]
    const { bins } = binEvents(events, 2)
    expect(bins[0].intensity).toBe(1) // 4 of 4 max
    expect(bins[1].intensity).toBe(0.5) // 2 of 4 max
  })

  it('marks error events with a top percentage position', () => {
    const events = [
      { ts: 0, level: 'info' },
      { ts: 500, level: 'error' },
      { ts: 1000, level: 'info' },
    ]
    const { errors } = binEvents(events, 10)
    expect(errors).toEqual([{ top: 50 }])
  })

  it('does not mark non-error levels', () => {
    const events = [
      { ts: 0, level: 'debug' },
      { ts: 500, level: 'warn' },
      { ts: 1000, level: 'info' },
    ]
    const { errors } = binEvents(events, 10)
    expect(errors).toEqual([])
  })

  it('handles a single distinct timestamp without dividing by zero', () => {
    const events = [
      { ts: 42, level: 'info' },
      { ts: 42, level: 'error' },
    ]
    const { bins, errors } = binEvents(events, 5)
    expect(bins).toEqual([{ top: 0, height: 20, intensity: 1 }])
    expect(errors).toEqual([{ top: 0 }])
  })
})
