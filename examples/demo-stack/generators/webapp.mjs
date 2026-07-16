// Web-app generator: generic logs at every level across a few namespaces,
// a periodic error burst (minimap texture), and an occasional event with an
// explicit unowned type ("metrics") to demo the not-installed banner.
const URL = process.env.LOGSAFE_URL ?? 'http://logsafe:4600/v1/log'
const SESSION = { session_id: 'webapp', session_label: 'Web app' }
const NS = ['auth:login', 'auth:token', 'cart:add', 'cart:checkout', 'ui:render']
const LINES = ['user signed in', 'token refreshed', 'item added', 'render pass', 'cache miss', 'session persisted']

async function post(events) {
  try { await fetch(URL, { method: 'POST', body: JSON.stringify(events) }) } catch {}
}
const rand = (a) => a[Math.floor(Math.random() * a.length)]
function level() {
  const r = Math.random()
  return r < 0.3 ? 'debug' : r < 0.8 ? 'info' : r < 0.95 ? 'warn' : 'error'
}

async function tick() {
  await post([{ ...SESSION, source: 'webapp', ns: rand(NS), level: level(), msg: rand(LINES),
    ctx: { user: `u-${1 + Math.floor(Math.random() * 5)}` } }])
  setTimeout(tick, 500 + Math.random() * 1500)
}
async function burst() {
  await post(Array.from({ length: 6 }, (_, i) => ({
    ...SESSION, source: 'webapp', ns: 'cart:checkout', level: 'error',
    msg: `payment provider timeout (attempt ${i + 1})`, ctx: { attempt: i + 1 } })))
  setTimeout(burst, 25000 + Math.random() * 10000)
}
async function metrics() {
  await post([{ ...SESSION, source: 'webapp', ns: 'metrics', type: 'metrics', level: 'info',
    msg: 'web-vitals sample', ctx: { lcp_ms: 1800 + Math.floor(Math.random() * 800) } }])
  setTimeout(metrics, 20000)
}
console.log('[webapp] generating ->', URL)
tick(); setTimeout(burst, 10000); setTimeout(metrics, 5000)
