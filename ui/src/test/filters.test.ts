import { describe, it, expect } from 'vitest'
import {
  filtersFromSearch,
  filtersToSearch,
  filtersToApiParams,
  toggleErrorLevel,
  type Filters,
} from '../lib/filters'

describe('filtersFromSearch', () => {
  it('extracts only known filter keys, ignoring ts/pin/sel', () => {
    const sp = new URLSearchParams('ts=abs&pin=1&sel=42&ns=auth:*&level=error')
    expect(filtersFromSearch(sp)).toEqual({ ns: 'auth:*', level: 'error' })
  })

  it('treats an absent or empty param as omitted', () => {
    const sp = new URLSearchParams('ns=&level=warn')
    expect(filtersFromSearch(sp)).toEqual({ level: 'warn' })
  })

  it('returns an empty object when no filter keys are present', () => {
    expect(filtersFromSearch(new URLSearchParams('ts=rel'))).toEqual({})
  })

  it('reads all five known filter keys', () => {
    const sp = new URLSearchParams('ns=a&level=b&source=c&trace=d&q=e')
    expect(filtersFromSearch(sp)).toEqual({ ns: 'a', level: 'b', source: 'c', trace: 'd', q: 'e' })
  })

  it('parses a valid integer `after` seq floor', () => {
    const sp = new URLSearchParams('after=500')
    expect(filtersFromSearch(sp)).toEqual({ after: 500 })
  })

  it('ignores a garbage (non-numeric) `after` value', () => {
    const sp = new URLSearchParams('after=abc')
    expect(filtersFromSearch(sp)).toEqual({})
  })

  it('ignores a non-finite `after` value', () => {
    const sp = new URLSearchParams('after=Infinity')
    expect(filtersFromSearch(sp)).toEqual({})
  })

  it('ignores a non-integer `after` value', () => {
    const sp = new URLSearchParams('after=1.5')
    expect(filtersFromSearch(sp)).toEqual({})
  })

  it('accepts `after=0`', () => {
    const sp = new URLSearchParams('after=0')
    expect(filtersFromSearch(sp)).toEqual({ after: 0 })
  })
})

describe('filtersToSearch', () => {
  it('preserves ts/pin/sel keys from the base params untouched', () => {
    const base = new URLSearchParams('ts=abs&pin=1&sel=42&ns=old&level=error')
    const result = filtersToSearch({ ns: 'new' }, base)
    expect(result.get('ts')).toBe('abs')
    expect(result.get('pin')).toBe('1')
    expect(result.get('sel')).toBe('42')
  })

  it('sets provided filter keys and removes filter keys absent from the new Filters', () => {
    const base = new URLSearchParams('ts=abs&ns=old&level=error&source=webapp')
    const result = filtersToSearch({ ns: 'new' }, base)
    expect(result.get('ns')).toBe('new')
    expect(result.has('level')).toBe(false)
    expect(result.has('source')).toBe(false)
  })

  it('round-trips: fromSearch(toSearch(f)) === f for a full filter set', () => {
    const f: Filters = { ns: 'auth:*', level: 'warn,error', source: 'api', trace: 't-1', q: 'timeout' }
    const sp = filtersToSearch(f, new URLSearchParams('ts=rel&pin=1&sel=9'))
    expect(filtersFromSearch(sp)).toEqual(f)
    expect(sp.get('ts')).toBe('rel')
    expect(sp.get('pin')).toBe('1')
    expect(sp.get('sel')).toBe('9')
  })

  it('round-trips a filter set including `after`', () => {
    const f: Filters = { ns: 'auth:*', after: 500 }
    const sp = filtersToSearch(f, new URLSearchParams('ts=rel'))
    expect(sp.get('after')).toBe('500')
    expect(filtersFromSearch(sp)).toEqual(f)
  })

  it('removes `after` from the result when absent from the new Filters', () => {
    const base = new URLSearchParams('ts=abs&after=500&ns=old')
    const result = filtersToSearch({ ns: 'old' }, base)
    expect(result.has('after')).toBe(false)
  })

  it('works with no base params supplied', () => {
    const sp = filtersToSearch({ q: 'boom' })
    expect(sp.toString()).toBe('q=boom')
  })

  it('does not mutate the base URLSearchParams passed in', () => {
    const base = new URLSearchParams('ns=old')
    filtersToSearch({ ns: 'new' }, base)
    expect(base.get('ns')).toBe('old')
  })
})

describe('filtersToApiParams', () => {
  it('includes only API-known filter keys, excluding ts/pin/sel', () => {
    const sp = new URLSearchParams('ts=abs&pin=1&sel=42&ns=auth:*&level=error')
    const f = filtersFromSearch(sp)
    const api = filtersToApiParams(f)
    expect(api.has('ts')).toBe(false)
    expect(api.has('pin')).toBe(false)
    expect(api.has('sel')).toBe(false)
    expect(api.get('ns')).toBe('auth:*')
    expect(api.get('level')).toBe('error')
  })

  it('omits keys that are absent from the Filters object', () => {
    const api = filtersToApiParams({ q: 'timeout' })
    expect(Array.from(api.keys())).toEqual(['q'])
  })

  it('produces an empty URLSearchParams for an empty Filters object', () => {
    expect(filtersToApiParams({}).toString()).toBe('')
  })

  it('never emits `after` — the hook owns per-page cursors, not the API filter set', () => {
    const api = filtersToApiParams({ ns: 'auth:*', after: 500 })
    expect(api.has('after')).toBe(false)
    expect(api.get('ns')).toBe('auth:*')
  })
})

describe('toggleErrorLevel', () => {
  it('sets level to warn,error when not already set', () => {
    expect(toggleErrorLevel({})).toEqual({ level: 'warn,error' })
  })

  it('sets level to warn,error, overwriting an unrelated level', () => {
    expect(toggleErrorLevel({ level: 'debug' })).toEqual({ level: 'warn,error' })
  })

  it('clears level when already warn,error (toggle off)', () => {
    expect(toggleErrorLevel({ level: 'warn,error' })).toEqual({ level: undefined })
  })

  it('preserves other filter keys untouched', () => {
    expect(toggleErrorLevel({ ns: 'auth:*', level: 'warn,error' })).toEqual({ ns: 'auth:*', level: undefined })
  })
})
