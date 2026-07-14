import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { registerSpa } from '../src/spa.js'

const MARKER = '<!doctype html><title>deblog-spa-marker</title>'

let app: FastifyInstance
let publicDir: string

afterEach(async () => {
  await app.close()
  if (publicDir) fs.rmSync(publicDir, { recursive: true, force: true })
})

async function buildWithPublicDir(): Promise<FastifyInstance> {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deblog-spa-'))
  fs.writeFileSync(path.join(publicDir, 'index.html'), MARKER)
  const built = buildApp({ db: openDb(':memory:') })
  await registerSpa(built, publicDir)
  await built.ready()
  return built
}

describe('SPA fallback', () => {
  it('GET /s/whatever -> 200 html with index.html content when public dir exists', async () => {
    app = await buildWithPublicDir()
    const res = await app.inject({ method: 'GET', url: '/s/whatever' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toBe(MARKER)
  })

  it('GET / -> 200 html', async () => {
    app = await buildWithPublicDir()
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toBe(MARKER)
  })

  it('GET /api/sessions/nope -> 404 json (API 404s stay JSON, regression)', async () => {
    app = await buildWithPublicDir()
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.json()).toEqual({ error: 'session not found' })
  })

  it('unknown /v1 path -> 404 json, not html fallback', async () => {
    app = await buildWithPublicDir()
    const res = await app.inject({ method: 'GET', url: '/v1/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('POST /v1/log is unaffected by the fallback', async () => {
    app = await buildWithPublicDir()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/log',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ msg: 'hello' }),
    })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
  })

  it('GET /api/definitely-not-a-route -> 404 json via the notFound fallback', async () => {
    app = await buildWithPublicDir()
    const res = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('POST /some/unknown/path -> 404 json (non-GET never gets the HTML fallback)', async () => {
    app = await buildWithPublicDir()
    const res = await app.inject({ method: 'POST', url: '/some/unknown/path' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('with no public dir, GET /s/x falls through to default 404 (no fallback registered)', async () => {
    const noPublicDb = openDb(':memory:')
    app = buildApp({ db: noPublicDb })
    // registerSpa is not called at all — mirrors index.ts's "only when public/ exists" branch
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/s/x' })
    expect(res.statusCode).toBe(404)
  })
})
