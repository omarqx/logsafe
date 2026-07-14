/**
 * deblog demo: emits a realistic two-source debug session and verifies it
 * back over the HTTP API. Usage:
 *   npm run demo            # emit, verify, exit
 *   npm run demo -- --keep  # leave the server running to browse
 */
import os from 'node:os'
import path from 'node:path'
import { openDb } from '../packages/server/src/db.js'
import { buildApp } from '../packages/server/src/app.js'
import { initDeblog, createLog, flush } from '../packages/client/src/index.js'

const PORT = Number(process.env.PORT ?? 4600)
const DB_PATH = process.env.DEBLOG_DB ?? path.join(os.homedir(), '.deblog', 'deblog.db')
const BASE = `http://127.0.0.1:${PORT}`
const KEEP = process.argv.includes('--keep')

const db = openDb(DB_PATH)
const app = buildApp({ db })
await app.listen({ host: '127.0.0.1', port: PORT })
console.log(`server up at ${BASE} (db: ${DB_PATH})`)

// ---- emit: webapp source via @deblog/client -------------------------------
const { sessionId } = initDeblog({
  source: 'webapp',
  sessionLabel: 'demo: checkout flow',
  url: BASE,
})
console.log(`session: ${sessionId}`)

const nav = createLog('nav')
const auth = createLog('auth:token')
const cart = createLog('cart')

// The client helper stamps ts itself, so webapp events cluster around "now";
// api events (sent raw) are backdated across a ~30s window for realistic spread.
let clock = Date.now() - 30_000
const tick = (ms: number): number => (clock += ms)

nav.info('page loaded', { path: '/checkout' })
auth.debug('token found in storage', { exp_in_s: 3542 })
auth.debug('token validated')
for (let i = 0; i < 20; i++) nav.debug(`route probe ${i}`, { idx: i })
cart.info('cart hydrated', { items: 3, total_cents: 8497 })
cart.warn('price changed since last view', { sku: 'SKU-771', old: 2799, new: 2999 })

const reqTrace = `req-${sessionId.slice(0, 6)}-pay`
const payLog = createLog('cart:payment').withTrace(reqTrace)
payLog.info('submitting payment', { provider: 'stripe' })
payLog.error('payment request failed', { status: 502, attempt: 1 })
payLog.error('payment request failed', { status: 502, attempt: 2 })
payLog.warn('falling back to retry queue')

await flush()

// ---- emit: api source via raw HTTP (the curl-equivalent path) --------------
async function post(events: unknown): Promise<void> {
  const res = await fetch(`${BASE}/v1/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(events),
  })
  if (res.status !== 202) throw new Error(`ingest failed: ${res.status}`)
}

const apiEvents: Record<string, unknown>[] = []
const api = (ns: string, level: string, msg: string, ctx?: unknown, trace?: string): void => {
  apiEvents.push({ session_id: sessionId, source: 'api', ns, level, msg, ts: tick(120), ctx, trace })
}

api('http', 'info', 'GET /api/cart 200', { ms: 12 })
for (let i = 0; i < 40; i++) api('db.pool', 'debug', `connection checkout ${i}`, { pool: 'main', free: 8 - (i % 4) })
api('http', 'info', 'POST /api/checkout 200', { ms: 45 })
api('payment.stripe', 'info', 'creating payment intent', { amount_cents: 8497 }, reqTrace)
api('payment.stripe', 'error', 'upstream 502 from stripe', { attempt: 1, latency_ms: 3021 }, reqTrace)
api('payment.stripe', 'error', 'upstream 502 from stripe', { attempt: 2, latency_ms: 3007 }, reqTrace)
api('payment.queue', 'warn', 'payment enqueued for retry', { queue_depth: 1 }, reqTrace)
for (let i = 0; i < 30; i++) api('http', 'debug', `GET /api/poll 200`, { ms: 3 + (i % 5) })

for (let i = 0; i < apiEvents.length; i += 25) await post(apiEvents.slice(i, i + 25))

// ---- verify over HTTP -------------------------------------------------------
let failures = 0
function check(name: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

const session = (await (await fetch(`${BASE}/api/sessions/${sessionId}`)).json()) as Record<string, unknown>
check('session exists with label', session.label === 'demo: checkout flow')
check('both sources recorded', JSON.stringify(session.sources) === '["api","webapp"]')
check('event_count = 105', session.event_count === 105)
check('error_count = 4', session.error_count === 4)

const errs = (await (await fetch(`${BASE}/api/sessions/${sessionId}/events?level=error`)).json()) as {
  events: unknown[]
}
check('4 error events queryable', errs.events.length === 4)

const traced = (await (
  await fetch(`${BASE}/api/sessions/${sessionId}/events?trace=${reqTrace}`)
).json()) as { events: { source: string }[] }
check('trace correlates across sources', new Set(traced.events.map((e) => e.source)).size === 2)

const nsFiltered = (await (
  await fetch(`${BASE}/api/sessions/${sessionId}/events?ns=payment.*`)
).json()) as { events: unknown[] }
check('ns wildcard payment.* matches 4', nsFiltered.events.length === 4)

const ndjson = await (await fetch(`${BASE}/api/sessions/${sessionId}/export.ndjson`)).text()
check('ndjson export has 105 lines', ndjson.trim().split('\n').length === 105)

console.log(`
Explore it yourself:
  curl '${BASE}/api/sessions'
  curl '${BASE}/api/sessions/${sessionId}/events?level=error'
  curl '${BASE}/api/sessions/${sessionId}/events?ns=payment.*,cart:*'
  curl '${BASE}/api/sessions/${sessionId}/events?trace=${reqTrace}'
  curl '${BASE}/api/sessions/${sessionId}/export.ndjson'
  curl -N '${BASE}/api/sessions/${sessionId}/stream'
`)

if (KEEP) {
  console.log('server still running (--keep). Ctrl-C to stop.')
} else {
  await app.close()
  process.exit(failures === 0 ? 0 : 1)
}
