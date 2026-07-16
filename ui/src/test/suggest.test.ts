import { describe, it, expect } from 'vitest'
import { suggest, type SuggestContext } from '../lib/suggest'

const ctx: SuggestContext = {
  sources: ['api', 'web', 'worker'],
  nsValues: ['auth.login', 'auth.logout', 'payment.charge', 'payment.refund'],
  traceValues: ['t-3', 't-2', 't-1'], // ctx is expected to already be most-recent-first
}

const emptyCtx: SuggestContext = { sources: [], nsValues: [], traceValues: [] }

describe('suggest', () => {
  describe('bare/partial word -> key prefixes', () => {
    it('lists all five key prefixes with hints for an empty token', () => {
      const items = suggest('', ctx)
      expect(items.map((i) => i.insert)).toEqual(['ns:', 'level:', 'source:', 'trace:', 'q:'])
      for (const item of items) {
        expect(item.hint).toBeTruthy()
      }
    })

    it('prefix-filters key names', () => {
      const items = suggest('le', ctx)
      expect(items.map((i) => i.insert)).toEqual(['level:'])
    })

    it('is case-insensitive on the key prefix', () => {
      const items = suggest('LE', ctx)
      expect(items.map((i) => i.insert)).toEqual(['level:'])
    })

    it('returns [] for a bare word matching no key prefix (free text)', () => {
      expect(suggest('timeout', ctx)).toEqual([])
      expect(suggest('hello world'.split(' ')[1], ctx)).toEqual([])
    })

    it('key completions do not end requiring a trailing space marker (insert ends with the colon)', () => {
      const items = suggest('n', ctx)
      expect(items).toEqual([{ insert: 'ns:', label: 'ns:', hint: expect.any(String) }])
    })
  })

  describe('level:', () => {
    it('lists all levels for a bare "level:"', () => {
      const items = suggest('level:', ctx)
      expect(items.map((i) => i.insert)).toEqual(['level:debug', 'level:info', 'level:warn', 'level:error'])
    })

    it('prefix-matches a partial value', () => {
      expect(suggest('level:w', ctx).map((i) => i.insert)).toEqual(['level:warn'])
    })

    it('is case-insensitive on the value', () => {
      expect(suggest('level:W', ctx).map((i) => i.insert)).toEqual(['level:warn'])
    })

    it('is comma-aware: completes only the segment after the last comma', () => {
      expect(suggest('level:warn,e', ctx).map((i) => i.insert)).toEqual(['level:warn,error'])
    })

    it('comma-aware with no partial after the comma lists all remaining candidates', () => {
      expect(suggest('level:warn,', ctx).map((i) => i.insert)).toEqual([
        'level:warn,debug',
        'level:warn,info',
        'level:warn,warn',
        'level:warn,error',
      ])
    })
  })

  describe('source:', () => {
    it('lists ctx.sources for a bare "source:"', () => {
      expect(suggest('source:', ctx).map((i) => i.insert)).toEqual(['source:api', 'source:web', 'source:worker'])
    })

    it('prefix-matches and is comma-aware', () => {
      expect(suggest('source:w', ctx).map((i) => i.insert)).toEqual(['source:web', 'source:worker'])
      expect(suggest('source:api,w', ctx).map((i) => i.insert)).toEqual(['source:api,web', 'source:api,worker'])
    })

    it('returns [] when ctx.sources is empty', () => {
      expect(suggest('source:', emptyCtx)).toEqual([])
    })
  })

  describe('ns:', () => {
    it('prefix-matches ctx.nsValues and appends a glob suggestion', () => {
      const items = suggest('ns:pay', ctx)
      expect(items.map((i) => i.insert)).toEqual(['ns:payment.charge', 'ns:payment.refund', 'ns:pay*'])
    })

    it('does not append a glob suggestion when the partial is empty', () => {
      const items = suggest('ns:', ctx)
      expect(items.map((i) => i.insert)).toEqual([
        'ns:auth.login',
        'ns:auth.logout',
        'ns:payment.charge',
        'ns:payment.refund',
      ])
    })

    it('is comma-aware, including the glob suggestion', () => {
      const items = suggest('ns:auth.login,pay', ctx)
      expect(items.map((i) => i.insert)).toEqual([
        'ns:auth.login,payment.charge',
        'ns:auth.login,payment.refund',
        'ns:auth.login,pay*',
      ])
    })

    it('glob-only suggestion when no ns value matches the partial', () => {
      expect(suggest('ns:zzz', ctx).map((i) => i.insert)).toEqual(['ns:zzz*'])
    })
  })

  describe('trace:', () => {
    it('lists ctx.traceValues most-recent-first, as provided by ctx', () => {
      expect(suggest('trace:', ctx).map((i) => i.insert)).toEqual(['trace:t-3', 'trace:t-2', 'trace:t-1'])
    })

    it('prefix-matches', () => {
      expect(suggest('trace:t-1', ctx).map((i) => i.insert)).toEqual(['trace:t-1'])
    })

    it('caps at 8 even if ctx.traceValues has more', () => {
      const many: SuggestContext = { ...emptyCtx, traceValues: Array.from({ length: 12 }, (_, i) => `t-${i}`) }
      expect(suggest('trace:', many)).toHaveLength(8)
    })
  })

  describe('q: / free text -> no suggestions', () => {
    it('q: with a value returns []', () => {
      expect(suggest('q:x', ctx)).toEqual([])
    })

    it('bare q: returns []', () => {
      expect(suggest('q:', ctx)).toEqual([])
    })
  })

  describe('unrecognized key prefix', () => {
    it('returns [] for a key not in the known set', () => {
      expect(suggest('foo:bar', ctx)).toEqual([])
    })
  })

  describe('cap at 8', () => {
    it('caps level/source/ns candidate lists at 8', () => {
      const many: SuggestContext = {
        sources: Array.from({ length: 12 }, (_, i) => `src-${i}`),
        nsValues: [],
        traceValues: [],
      }
      expect(suggest('source:', many)).toHaveLength(8)
    })
  })
})
