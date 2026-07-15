// @vitest-environment jsdom
// Covers the minimap error-mark dedup fix in SessionDetailPage.tsx:
// computeMinimapData quantizes each error mark's `top` position to a 0.25%
// slot (400 slots across the strip) and keeps only the first (earliest
// seq) mark per slot, so an error storm renders a bounded number of DOM
// nodes instead of one per error event. binEvents itself (lib/minimap.ts)
// is unchanged and stays covered by minimap.test.ts — this only exercises
// the page's wrapper.
import { describe, it, expect } from 'vitest'
import { computeMinimapData } from '../routes/SessionDetailPage'
import type { StoredEvent } from '../api'

function errorEvent(seq: number, ts: number): StoredEvent {
  return {
    seq,
    session_id: 's1',
    ts,
    received_at: ts,
    source: 'webapp',
    ns: 'retry',
    level: 'error',
    msg: `attempt ${seq} failed`,
    ctx: null,
    trace: null,
    type: 'log',
  }
}

describe('computeMinimapData: error-mark dedup', () => {
  it('bounds marks to <= 401 nodes for 10,000 errors spread across the timeline', () => {
    const events: StoredEvent[] = []
    for (let i = 0; i < 10_000; i++) {
      events.push(errorEvent(i, i)) // ts 0..9999, spread evenly across the full span
    }

    const { errors } = computeMinimapData(events)

    expect(errors.length).toBeLessThanOrEqual(401)
    // Sanity: dedup didn't collapse everything into one mark either — a
    // spread-out storm should still populate a meaningful chunk of slots.
    expect(errors.length).toBeGreaterThan(1)
  })

  it('keeps the earliest seq for each quantized position', () => {
    // All three share the same ts (and therefore the same `top`), so they
    // land in the same quantized slot — only the first (lowest seq) survives.
    const events: StoredEvent[] = [errorEvent(5, 100), errorEvent(6, 100), errorEvent(7, 100)]
    const { errors } = computeMinimapData(events)
    expect(errors).toHaveLength(1)
    expect(errors[0].seq).toBe(5)
  })

  it('does not dedupe error marks at clearly distinct positions', () => {
    const events: StoredEvent[] = [errorEvent(1, 0), errorEvent(2, 500), errorEvent(3, 1000)]
    const { errors } = computeMinimapData(events)
    expect(errors.map((e) => e.seq)).toEqual([1, 2, 3])
  })
})
