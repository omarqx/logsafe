import { describe, it, expect, vi } from 'vitest'
import { confirmAndPurge, applyPurgeOutcome } from '../lib/purge'
import type { SessionSummary } from '../api'

const SESSION: SessionSummary = {
  id: 's1',
  label: null,
  first_ts: 0,
  last_ts: 1000,
  duration_ms: 1000,
  status: 'idle',
  event_count: 2,
  error_count: 0,
  warn_count: 0,
  sources: ['webapp'],
}

describe('confirmAndPurge', () => {
  it('declines without calling purgeFn when confirmFn returns false', async () => {
    const confirmFn = vi.fn().mockReturnValue(false)
    const purgeFn = vi.fn()
    const outcome = await confirmAndPurge({ id: 's1', floor: 500, confirmFn, purgeFn })
    expect(outcome).toBe('declined')
    expect(purgeFn).not.toHaveBeenCalled()
  })

  it('passes the exact spec confirmation text, interpolating the floor seq', async () => {
    const confirmFn = vi.fn().mockReturnValue(false)
    const purgeFn = vi.fn()
    await confirmAndPurge({ id: 's1', floor: 500, confirmFn, purgeFn })
    expect(confirmFn).toHaveBeenCalledWith(
      'Permanently delete all events up to seq 500 in this session? This cannot be undone.',
    )
  })

  it('calls purgeFn(id, floor) and returns "purged" when confirmed and a session survives', async () => {
    const confirmFn = vi.fn().mockReturnValue(true)
    const purgeFn = vi.fn().mockResolvedValue({ deleted: 3, session: SESSION })
    const outcome = await confirmAndPurge({ id: 's1', floor: 500, confirmFn, purgeFn })
    expect(purgeFn).toHaveBeenCalledWith('s1', 500)
    expect(outcome).toBe('purged')
  })

  it('returns "purged-all" when confirmed and the response session is null', async () => {
    const confirmFn = vi.fn().mockReturnValue(true)
    const purgeFn = vi.fn().mockResolvedValue({ deleted: 5, session: null })
    const outcome = await confirmAndPurge({ id: 's1', floor: 500, confirmFn, purgeFn })
    expect(outcome).toBe('purged-all')
  })

  it('propagates a purgeFn rejection to the caller instead of swallowing it', async () => {
    const confirmFn = vi.fn().mockReturnValue(true)
    const purgeFn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(confirmAndPurge({ id: 's1', floor: 500, confirmFn, purgeFn })).rejects.toThrow('boom')
  })
})

describe('applyPurgeOutcome', () => {
  it('calls navigateHome (and not clearFloor) for "purged-all"', () => {
    const navigateHome = vi.fn()
    const clearFloor = vi.fn()
    applyPurgeOutcome('purged-all', { navigateHome, clearFloor })
    expect(navigateHome).toHaveBeenCalledTimes(1)
    expect(clearFloor).not.toHaveBeenCalled()
  })

  it('calls clearFloor (and not navigateHome) for "purged"', () => {
    const navigateHome = vi.fn()
    const clearFloor = vi.fn()
    applyPurgeOutcome('purged', { navigateHome, clearFloor })
    expect(clearFloor).toHaveBeenCalledTimes(1)
    expect(navigateHome).not.toHaveBeenCalled()
  })

  it('calls neither callback for "declined"', () => {
    const navigateHome = vi.fn()
    const clearFloor = vi.fn()
    applyPurgeOutcome('declined', { navigateHome, clearFloor })
    expect(navigateHome).not.toHaveBeenCalled()
    expect(clearFloor).not.toHaveBeenCalled()
  })
})
