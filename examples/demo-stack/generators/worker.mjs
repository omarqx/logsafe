// Job-worker generator: job:* lifecycle events (start -> done|failed with
// duration), 4 job kinds, ~10% failures, occasional generic warn.
const URL = process.env.LOGSAFE_URL ?? 'http://logsafe:4600/v1/log'
const SESSION = { session_id: 'job-worker', session_label: 'Job worker' }
const KINDS = ['resize-image', 'send-email', 'sync-inventory', 'export-report']
// Seeded per process start: ids stay unique across container restarts, so a
// persisted volume's derived rows (keyed by trace/job_id) are never overwritten.
let n = 0
const RUN = Date.now().toString(36)

async function post(events) {
  try { await fetch(URL, { method: 'POST', body: JSON.stringify(events) }) } catch {}
}

async function runJob() {
  const name = KINDS[Math.floor(Math.random() * KINDS.length)]
  const job_id = `${name}-${RUN}-${++n}`
  const duration = 100 + Math.floor(Math.random() * 2400)
  const fails = Math.random() < 0.1
  await post([{ ...SESSION, source: 'worker', ns: `job:${name}`, level: 'info',
    msg: `job start ${job_id}`, ctx: { job_id, name, event: 'start' } }])
  setTimeout(async () => {
    if (fails && Math.random() < 0.5) {
      await post([{ ...SESSION, source: 'worker', ns: 'app', level: 'warn',
        msg: `job ${job_id} retrying after transient error`, ctx: { job_id } }])
    }
    await post([{ ...SESSION, source: 'worker', ns: `job:${name}`,
      level: fails ? 'error' : 'info',
      msg: `job ${fails ? 'failed' : 'done'} ${job_id} in ${duration}ms`,
      ctx: { job_id, name, event: fails ? 'failed' : 'done', duration_ms: duration } }])
  }, duration)
  setTimeout(runJob, 2000 + Math.random() * 3000)
}
console.log('[worker] generating ->', URL)
runJob()
