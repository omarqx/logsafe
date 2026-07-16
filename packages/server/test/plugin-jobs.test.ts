import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { makePluginContext } from '../src/plugins/context.js'
import type { LoadedServerPlugin } from '../src/plugins/loader.js'
import jobsPlugin from '../../../examples/plugin-jobs/server.js'

const MANIFEST = { id: 'jobs', version: '0.1.0', apiVersion: '1', ownedTypes: ['job'], priority: 4 }

function loaded(db: Db): LoadedServerPlugin {
  const ctx = makePluginContext(db, 'jobs')
  jobsPlugin.migrate?.(ctx)
  return { manifest: MANIFEST, plugin: jobsPlugin, ctx }
}

const ev = (event: string, job_id: string, extra: Record<string, unknown> = {}) => ({
  msg: `${event} ${job_id}`, session_id: 's1', source: 'worker', ns: 'job:resize',
  ctx: { job_id, name: 'resize', event, ...extra },
})

describe('plugin-jobs server', () => {
  let db: Db
  let app: ReturnType<typeof buildApp>
  beforeEach(() => {
    db = openDb(':memory:')
    app = buildApp({ db, plugins: [loaded(db)] })
  })

  const post = (events: unknown[]) => app.inject({ method: 'POST', url: '/v1/log', payload: events })
  const summary = async () => (await app.inject({ method: 'GET', url: '/api/plugins/jobs/summary/s1' })).json()
  const runs = async () => (await app.inject({ method: 'GET', url: '/api/plugins/jobs/durations/s1' })).json().runs

  it('claims job:* events; start creates a running row', async () => {
    await post([ev('start', 'j1'), { msg: 'other', session_id: 's1', source: 'worker', ns: 'app' }])
    const events = (await app.inject({ method: 'GET', url: '/api/sessions/s1/events' })).json().events
    expect(events.find((e: { ns: string }) => e.ns === 'job:resize').type).toBe('job')
    expect(events.find((e: { ns: string }) => e.ns === 'app').type).toBe('generic')
    expect(await summary()).toEqual({ processed: 0, running: 1, failed: 0, failure_rate_pct: 0, avg_duration_ms: 0, max_duration_ms: 0 })
  })

  it('done finalizes with duration; failed counts; summary aggregates over completed only', async () => {
    await post([ev('start', 'j1'), ev('start', 'j2'), ev('start', 'j3')])
    await post([ev('done', 'j1', { duration_ms: 200 }), ev('failed', 'j2', { duration_ms: 800 })])
    expect(await summary()).toEqual({
      processed: 2, running: 1, failed: 1, failure_rate_pct: 50,
      avg_duration_ms: 500, max_duration_ms: 800,
    })
    expect((await runs()).map((r: JobLike) => [r.job_id, r.status, r.duration_ms]))
      .toEqual([['j1', 'done', 200], ['j2', 'failed', 800]]) // completed only, ts ASC
  })

  it('a late/replayed start does not resurrect a finished run', async () => {
    await post([ev('start', 'j1')])
    await post([ev('done', 'j1', { duration_ms: 150 })])
    await post([ev('start', 'j1')]) // replay
    const r = (await runs()).find((x: JobLike) => x.job_id === 'j1')
    expect(r.status).toBe('done')
    expect(r.duration_ms).toBe(150)
  })

  it('an out-of-order final with no prior start still creates the row', async () => {
    await post([ev('done', 'orphan', { duration_ms: 99 })])
    expect((await runs()).find((x: JobLike) => x.job_id === 'orphan').status).toBe('done')
  })

  it('ignores claimed events without job_id/event; cleans rows on session delete', async () => {
    await post([{ msg: 'job chatter', session_id: 's1', source: 'worker', ns: 'job', ctx: { note: 'no lifecycle' } }, ev('start', 'j9')])
    expect((await summary()).running).toBe(1) // chatter ignored
    await app.inject({ method: 'DELETE', url: '/api/sessions/s1' })
    const c = db.prepare('SELECT COUNT(*) c FROM plugin_jobs_runs').get() as { c: number }
    expect(c.c).toBe(0)
  })
})

interface JobLike { job_id: string; status: string; duration_ms: number | null }
