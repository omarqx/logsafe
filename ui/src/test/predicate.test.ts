import { describe, it, expect } from 'vitest'
import { matchNs, eventMatches } from '../lib/predicate'
import type { StoredEvent } from '../api'
import type { Filters } from '../lib/filters'

function ev(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    seq: 1,
    session_id: 's1',
    ts: 100,
    received_at: 100,
    source: 'webapp',
    ns: 'auth:token',
    level: 'info',
    msg: 'token refreshed',
    ctx: null,
    trace: null,
    ...overrides,
  }
}

describe('matchNs', () => {
  it('matches an exact literal pattern', () => {
    expect(matchNs('auth:token', 'auth:token')).toBe(true)
    expect(matchNs('auth:token', 'auth:login')).toBe(false)
  })

  it('* as a prefix wildcard (suffix match)', () => {
    expect(matchNs('*.render', 'player.render')).toBe(true)
    expect(matchNs('*.render', 'player.update')).toBe(false)
  })

  it('* as a suffix wildcard (prefix match)', () => {
    expect(matchNs('auth:*', 'auth:token')).toBe(true)
    expect(matchNs('auth:*', 'auth:')).toBe(true)
    expect(matchNs('auth:*', 'other:token')).toBe(false)
  })

  it('* alone matches anything', () => {
    expect(matchNs('*', 'anything.at.all')).toBe(true)
    expect(matchNs('*', '')).toBe(true)
  })

  it('* mid-pattern matches a segment gap', () => {
    expect(matchNs('auth:*:done', 'auth:login:done')).toBe(true)
    expect(matchNs('auth:*:done', 'auth:done')).toBe(false)
  })

  it('escapes regex-special characters in the literal portion', () => {
    expect(matchNs('a.b', 'aXb')).toBe(false)
    expect(matchNs('a.b', 'a.b')).toBe(true)
    expect(matchNs('a+b', 'a+b')).toBe(true)
  })

  it('is case-sensitive, like GLOB', () => {
    expect(matchNs('Auth:*', 'auth:token')).toBe(false)
  })
})

describe('eventMatches', () => {
  it('matches everything when no filters are set', () => {
    expect(eventMatches({}, ev())).toBe(true)
  })

  it('ns: comma-list, OR across patterns, wildcard per pattern', () => {
    const f: Filters = { ns: 'auth:*,player.*' }
    expect(eventMatches(f, ev({ ns: 'auth:token' }))).toBe(true)
    expect(eventMatches(f, ev({ ns: 'player.render' }))).toBe(true)
    expect(eventMatches(f, ev({ ns: 'payment.charge' }))).toBe(false)
  })

  it('level: comma-list exact membership', () => {
    const f: Filters = { level: 'warn,error' }
    expect(eventMatches(f, ev({ level: 'error' }))).toBe(true)
    expect(eventMatches(f, ev({ level: 'warn' }))).toBe(true)
    expect(eventMatches(f, ev({ level: 'info' }))).toBe(false)
  })

  it('source: comma-list exact membership', () => {
    const f: Filters = { source: 'webapp,api' }
    expect(eventMatches(f, ev({ source: 'api' }))).toBe(true)
    expect(eventMatches(f, ev({ source: 'worker' }))).toBe(false)
  })

  it('trace: exact match only', () => {
    const f: Filters = { trace: 'abc-123' }
    expect(eventMatches(f, ev({ trace: 'abc-123' }))).toBe(true)
    expect(eventMatches(f, ev({ trace: 'other' }))).toBe(false)
    expect(eventMatches(f, ev({ trace: null }))).toBe(false)
  })

  it('q: case-insensitive substring over msg', () => {
    const f: Filters = { q: 'REFRESHED' }
    expect(eventMatches(f, ev({ msg: 'token refreshed' }))).toBe(true)
    expect(eventMatches(f, ev({ msg: 'token expired' }))).toBe(false)
  })

  it('q: case-insensitive substring over JSON.stringify(ctx) too', () => {
    const f: Filters = { q: 'userid' }
    expect(eventMatches(f, ev({ msg: 'no match here', ctx: { userId: 42 } }))).toBe(true)
  })

  it('q: does not match ctx when ctx is null (mirrors SQL LIKE against NULL)', () => {
    const f: Filters = { q: 'null' }
    expect(eventMatches(f, ev({ msg: 'nothing', ctx: null }))).toBe(false)
  })

  it('q: ASCII-only case folding, mirroring SQLite LIKE (not full Unicode toLowerCase)', () => {
    // 'İ' (U+0130, Turkish dotted capital I) lowercases to 'i̇' under full
    // Unicode folding, which would make 'istanbul' match — but SQLite LIKE
    // only folds ASCII, so it does not match, and neither should we.
    expect(eventMatches({ q: 'istanbul' }, ev({ msg: 'İstanbul error' }))).toBe(false)

    // ASCII case folding still works as before.
    expect(eventMatches({ q: 'ERROR' }, ev({ msg: 'an error' }))).toBe(true)

    // Non-ASCII letters are matched literally (no folding at all): the
    // exact accented case matches, but the differently-cased accented
    // variant does not.
    expect(eventMatches({ q: 'café' }, ev({ msg: 'café' }))).toBe(true)
    expect(eventMatches({ q: 'CAFÉ' }, ev({ msg: 'café' }))).toBe(false)
  })

  it('combines multiple filters with AND', () => {
    const f: Filters = { level: 'error', source: 'api' }
    expect(eventMatches(f, ev({ level: 'error', source: 'api' }))).toBe(true)
    expect(eventMatches(f, ev({ level: 'error', source: 'webapp' }))).toBe(false)
  })

  it('empty-string filter values behave as absent', () => {
    expect(eventMatches({ ns: '' }, ev())).toBe(true)
  })
})
