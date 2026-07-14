import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initLogsafe, createLog, flush, _resetForTests } from '../src/index.js'

const fetchMock = vi.fn()

beforeEach(() => {
  _resetForTests()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function sentBatches(): Record<string, unknown>[][] {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string))
}

describe('logsafe-client', () => {
  it('is a no-op before init and when disabled', async () => {
    createLog('a').info('dropped')
    initLogsafe({ source: 'webapp', enabled: false })
    createLog('a').info('also dropped')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('batches events and flushes after 250ms', async () => {
    initLogsafe({ source: 'webapp', sessionId: 's1', sessionLabel: 'run A' })
    const log = createLog('auth:token')
    log.debug('one', { n: 1 })
    log.error('two')
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:4600/v1/log')
    expect((init as RequestInit).method).toBe('POST')
    const batch = sentBatches()[0]
    expect(batch).toHaveLength(2)
    expect(batch[0]).toMatchObject({
      session_id: 's1',
      source: 'webapp',
      ns: 'auth:token',
      level: 'debug',
      msg: 'one',
      ctx: { n: 1 },
      session_label: 'run A', // label rides only the first event
    })
    expect(batch[1]).not.toHaveProperty('session_label')
    expect(typeof batch[0].ts).toBe('number')
  })

  it('flushes immediately at 64 buffered events', async () => {
    initLogsafe({ source: 'webapp', sessionId: 's1' })
    const log = createLog('bulk')
    for (let i = 0; i < 64; i++) log.info(`m${i}`)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentBatches()[0]).toHaveLength(64)
  })

  it('withTrace binds trace onto every event', async () => {
    initLogsafe({ source: 'api', sessionId: 's1' })
    const log = createLog('req').withTrace('t-42')
    log.info('handled')
    await flush()
    expect(sentBatches()[0][0]).toMatchObject({ trace: 't-42', ns: 'req' })
  })

  it('generates a sessionId when none supplied', () => {
    const { sessionId } = initLogsafe({ source: 'webapp' })
    expect(sessionId).toMatch(/^[0-9a-z]+-[0-9a-z]{12}$/)
  })

  it('buffers on network failure, then drops oldest beyond 10k and reports drops', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initLogsafe({ source: 'webapp', sessionId: 's1' })
    const log = createLog('spam')

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    for (let i = 0; i < 10_050; i++) log.info(`m${i}`)
    await vi.advanceTimersByTimeAsync(300)
    expect(warnSpy).toHaveBeenCalledTimes(1) // exactly one warn, not one per flush

    fetchMock.mockResolvedValue({ ok: true })
    await flush()
    const all = sentBatches().flat()
    const dropNotice = all.find((e) => e.ns === 'logsafe' && e.level === 'warn')
    expect(dropNotice).toBeDefined()
    expect(dropNotice!.msg).toMatch(/dropped 50 events/)
    warnSpy.mockRestore()
  })

  it('a non-serializable ctx never throws and never wedges the buffer', async () => {
    initLogsafe({ source: 'webapp', sessionId: 's1' })
    const log = createLog('poison')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => log.info('bad', circular)).not.toThrow()
    log.info('good')
    await flush()
    const sent = sentBatches().flat()
    expect(sent.some((e) => e.msg === 'good')).toBe(true)
    expect(sent.some((e) => e.msg === 'bad')).toBe(false)
    // buffer drained: a subsequent event still flows
    log.info('after')
    await flush()
    expect(sentBatches().flat().some((e) => e.msg === 'after')).toBe(true)
  })

  it('repeated initLogsafe does not stack process listeners', () => {
    const before = process.listenerCount('beforeExit')
    initLogsafe({ source: 'a' })
    initLogsafe({ source: 'b' })
    initLogsafe({ source: 'c' })
    expect(process.listenerCount('beforeExit')).toBeLessThanOrEqual(before + 1)
  })
})
