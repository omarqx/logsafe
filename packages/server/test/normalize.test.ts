import { describe, it, expect } from 'vitest'
import { normalizeEvent, scratchSessionId } from '../src/normalize.js'

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0) // 2026-07-13T12:00:00Z

describe('normalizeEvent', () => {
  it('rejects only non-objects and missing/empty msg', () => {
    expect(normalizeEvent(null, NOW)).toBeNull()
    expect(normalizeEvent('hi', NOW)).toBeNull()
    expect(normalizeEvent([{ msg: 'x' }], NOW)).toBeNull()
    expect(normalizeEvent({}, NOW)).toBeNull()
    expect(normalizeEvent({ msg: '' }, NOW)).toBeNull()
    expect(normalizeEvent({ msg: 'x' }, NOW)).not.toBeNull()
  })

  it('applies defaults: source, ns, level, ts, scratch session', () => {
    const ev = normalizeEvent({ msg: 'hello' }, NOW)!
    expect(ev).toMatchObject({
      session_id: 'scratch-2026-07-13',
      source: 'default',
      ns: '',
      level: 'info',
      msg: 'hello',
      ts: NOW,
      received_at: NOW,
      ctx: null,
      trace: null,
      session_label: null,
    })
  })

  it('accepts epoch-ms and ISO ts; bad ts falls back to now', () => {
    expect(normalizeEvent({ msg: 'x', ts: 1234 }, NOW)!.ts).toBe(1234)
    expect(normalizeEvent({ msg: 'x', ts: '2026-07-13T11:59:00Z' }, NOW)!.ts).toBe(NOW - 60_000)
    expect(normalizeEvent({ msg: 'x', ts: 'garbage' }, NOW)!.ts).toBe(NOW)
    expect(normalizeEvent({ msg: 'x', ts: NaN }, NOW)!.ts).toBe(NOW)
  })

  it('coerces unknown level to info, preserving original at ctx._level', () => {
    const noCtx = normalizeEvent({ msg: 'x', level: 'FATAL' }, NOW)!
    expect(noCtx.level).toBe('info')
    expect(JSON.parse(noCtx.ctx!)).toEqual({ _level: 'FATAL' })

    const objCtx = normalizeEvent({ msg: 'x', level: 'trace', ctx: { a: 1 } }, NOW)!
    expect(JSON.parse(objCtx.ctx!)).toEqual({ a: 1, _level: 'trace' })

    const scalarCtx = normalizeEvent({ msg: 'x', level: 5, ctx: 'raw' }, NOW)!
    expect(JSON.parse(scalarCtx.ctx!)).toEqual({ _level: 5, value: 'raw' })
  })

  it('passes through valid fields, serializes ctx', () => {
    const ev = normalizeEvent(
      { msg: 'm', session_id: 's1', source: 'api', ns: 'auth:token', level: 'error', ctx: { u: 7 }, trace: 't-1', session_label: 'run A' },
      NOW,
    )!
    expect(ev).toMatchObject({ session_id: 's1', source: 'api', ns: 'auth:token', level: 'error', trace: 't-1', session_label: 'run A' })
    expect(ev.ctx).toBe(JSON.stringify({ u: 7 }))
  })
})

describe('scratchSessionId', () => {
  it('buckets by UTC day', () => {
    expect(scratchSessionId(NOW)).toBe('scratch-2026-07-13')
  })
})
