// API-gateway traffic generator: http-typed request events + a paired
// generic log line sharing the same trace (cross-source trace filtering).
const URL = process.env.LOGSAFE_URL ?? 'http://logsafe:4600/v1/log'
const SESSION = { session_id: 'api-gateway', session_label: 'API gateway' }
const ROUTES = ['/api/products', '/api/cart', '/api/search', '/api/checkout', '/api/user']
// Seeded per process start: ids stay unique across container restarts, so a
// persisted volume's derived rows (keyed by trace/job_id) are never overwritten.
let n = 0
const RUN = Date.now().toString(36)

const rand = (a) => a[Math.floor(Math.random() * a.length)]
function latency() {
  if (Math.random() < 0.08) return 1000 + Math.floor(Math.random() * 1500) // slow tail
  return 20 + Math.floor(Math.random() * 380)
}
function status() {
  const r = Math.random()
  return r < 0.8 ? 200 : r < 0.9 ? 404 : 500
}

async function post(events) {
  try {
    await fetch(URL, { method: 'POST', body: JSON.stringify(events) })
  } catch { /* logsafe not up yet — drop and keep looping */ }
}

async function tick() {
  const trace = `r-${RUN}-${++n}`
  const path = rand(ROUTES)
  const method = path === '/api/checkout' || path === '/api/cart' ? 'POST' : 'GET'
  const st = status(), lat = latency()
  await post([
    { ...SESSION, source: 'gateway', ns: `http:${path.split('/')[2]}`, trace,
      level: st >= 500 ? 'error' : 'info',
      msg: `${method} ${path} ${st} ${lat}ms`,
      ctx: { method, path, status: st, latency_ms: lat } },
    { ...SESSION, source: 'gateway', ns: 'app', trace, level: 'debug',
      msg: `handler ${path} completed`, ctx: { latency_ms: lat } },
  ])
  setTimeout(tick, 1000 + Math.random() * 2000)
}
console.log('[gateway] generating ->', URL)
tick()
