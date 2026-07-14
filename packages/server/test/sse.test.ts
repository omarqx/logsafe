import { describe, it, expect, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'

let app: FastifyInstance
afterEach(async () => {
  await app.close()
})

/** Read SSE 'log' frames from a streaming response until `count` events arrive. */
async function readEvents(res: Response, count: number): Promise<Record<string, unknown>[]> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const events: Record<string, unknown>[] = []
  while (events.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const data = frame.split('\n').find((l) => l.startsWith('data: '))
      if (frame.startsWith('event: log') && data) events.push(JSON.parse(data.slice(6)))
    }
  }
  await reader.cancel()
  return events
}

describe('GET /api/sessions/:id/stream', () => {
  it('replays after_seq then streams live events', async () => {
    app = buildApp({ db: openDb(':memory:') })
    const base = `http://127.0.0.1:${await listen(app)}`

    // two pre-existing events
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { msg: 'old-1', session_id: 's1' },
        { msg: 'old-2', session_id: 's1' },
      ]),
    })

    const res = await fetch(`${base}/api/sessions/s1/stream?after_seq=1`)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // live event, sent while the stream is open
    const eventsPromise = readEvents(res, 2)
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: 'live-1', session_id: 's1' }),
    })

    const events = await eventsPromise
    expect(events.map((e) => e.msg)).toEqual(['old-2', 'live-1']) // old-1 excluded by after_seq=1
    expect(events.map((e) => e.seq)).toEqual([2, 3])
  })

  it('does not deliver events from other sessions', async () => {
    app = buildApp({ db: openDb(':memory:') })
    const base = `http://127.0.0.1:${await listen(app)}`
    const res = await fetch(`${base}/api/sessions/s1/stream`)
    const eventsPromise = readEvents(res, 1)
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ msg: 'other', session_id: 'other' }, { msg: 'mine', session_id: 's1' }]),
    })
    const events = await eventsPromise
    expect(events.map((e) => e.msg)).toEqual(['mine'])
  })
})

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ host: '127.0.0.1', port: 0 })
  const addr = app.server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  return addr.port
}
