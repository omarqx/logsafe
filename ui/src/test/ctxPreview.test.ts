import { describe, it, expect } from 'vitest'
import { getCtxPreview } from '../lib/ctxPreview'
import type { StoredEvent } from '../api'

function makeEvent(ctx: unknown): StoredEvent {
  return {
    seq: 1,
    session_id: 's1',
    ts: 0,
    received_at: 0,
    source: 'webapp',
    ns: 'nav',
    level: 'info',
    msg: 'x',
    ctx,
    trace: null,
    type: 'log',
  }
}

describe('getCtxPreview', () => {
  it('returns an empty string when ctx is null or undefined', () => {
    expect(getCtxPreview(makeEvent(null))).toBe('')
    expect(getCtxPreview(makeEvent(undefined))).toBe('')
  })

  it('returns the compact JSON string for small ctx', () => {
    expect(getCtxPreview(makeEvent({ path: '/checkout' }))).toBe('{"path":"/checkout"}')
  })

  it('truncates to 120 chars with a trailing ellipsis for large ctx', () => {
    const big = { data: 'x'.repeat(200) }
    const preview = getCtxPreview(makeEvent(big))
    expect(preview.length).toBe(121) // 120 chars + '…'
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.startsWith('{"data":"xxx')).toBe(true)
  })

  it('caches the result per event object identity (same reference in, same string out)', () => {
    const ev = makeEvent({ n: 1 })
    const first = getCtxPreview(ev)
    // Mutate ctx after first computation — a cached call must NOT re-stringify.
    ;(ev as { ctx: unknown }).ctx = { n: 999 }
    const second = getCtxPreview(ev)
    expect(second).toBe(first)
    expect(second).toBe('{"n":1}')
  })

  it('does not share the cache across distinct event objects with identical content', () => {
    const a = makeEvent({ n: 1 })
    const b = makeEvent({ n: 1 })
    expect(getCtxPreview(a)).toBe(getCtxPreview(b))
    // Different identities, independently cached — mutating one's cache
    // input after the fact must not affect the other's already-cached value.
    ;(a as { ctx: unknown }).ctx = { n: 2 }
    expect(getCtxPreview(b)).toBe('{"n":1}')
  })
})
