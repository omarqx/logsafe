import { describe, it, expect } from 'vitest'
import { parseCmdInput } from '../lib/cmdInput'

describe('parseCmdInput', () => {
  it('splits key:value tokens into filters and leftover words into q', () => {
    expect(parseCmdInput('ns:auth:* level:error text')).toEqual({
      filters: { ns: 'auth:*', level: 'error' },
      q: 'text',
    })
  })

  it('supports all four recognized keys', () => {
    expect(parseCmdInput('ns:payment.* level:warn,error source:api trace:req-1')).toEqual({
      filters: { ns: 'payment.*', level: 'warn,error', source: 'api', trace: 'req-1' },
      q: '',
    })
  })

  it('treats bare text with no key:value tokens as q only', () => {
    expect(parseCmdInput('stripe payment failed')).toEqual({
      filters: {},
      q: 'stripe payment failed',
    })
  })

  it('joins multiple bare words with single spaces, preserving order relative to each other', () => {
    expect(parseCmdInput('foo ns:a bar')).toEqual({
      filters: { ns: 'a' },
      q: 'foo bar',
    })
  })

  it('collapses repeated whitespace and ignores leading/trailing space', () => {
    expect(parseCmdInput('  ns:a   level:error   ')).toEqual({
      filters: { ns: 'a', level: 'error' },
      q: '',
    })
  })

  it('returns empty filters and empty q for an empty/whitespace-only string', () => {
    expect(parseCmdInput('')).toEqual({ filters: {}, q: '' })
    expect(parseCmdInput('   ')).toEqual({ filters: {}, q: '' })
  })

  it('last occurrence of a repeated key wins', () => {
    expect(parseCmdInput('ns:a ns:b')).toEqual({ filters: { ns: 'b' }, q: '' })
  })

  it('does not treat an unrecognized key: prefix as a filter token', () => {
    expect(parseCmdInput('foo:bar ns:a')).toEqual({
      filters: { ns: 'a' },
      q: 'foo:bar',
    })
  })

  it('recognizes q: as an explicit free-text prefix (ctx-field fragments)', () => {
    // the documented ctx-field trick — colons and quotes in the value survive
    expect(parseCmdInput('q:"label":"Dogs"')).toEqual({
      filters: {},
      q: '"label":"Dogs"',
    })
  })

  it('q: combines with other filters and is equivalent to the bare form', () => {
    expect(parseCmdInput('source:vote q:"label":"Dogs"')).toEqual({
      filters: { source: 'vote' },
      q: '"label":"Dogs"',
    })
    // bare (no q: prefix) yields the same q
    expect(parseCmdInput('source:vote "label":"Dogs"')).toEqual({
      filters: { source: 'vote' },
      q: '"label":"Dogs"',
    })
  })
})
