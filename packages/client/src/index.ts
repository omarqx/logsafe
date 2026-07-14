export type Level = 'debug' | 'info' | 'warn' | 'error'
export type Ctx = Record<string, unknown>

export interface InitOptions {
  source: string
  /** Server base URL. Default http://127.0.0.1:4600 */
  url?: string
  /** Session id. Default: generated, time-sortable. */
  sessionId?: string
  /** Human-readable label, sent once on the first event. */
  sessionLabel?: string
  /** Default true. false leaves every logger call a no-op. */
  enabled?: boolean
}

export interface Logger {
  debug(msg: string, ctx?: Ctx): void
  info(msg: string, ctx?: Ctx): void
  warn(msg: string, ctx?: Ctx): void
  error(msg: string, ctx?: Ctx): void
  withTrace(trace: string): Logger
}

interface WireEvent {
  ts: number
  session_id: string
  source: string
  ns: string
  level: Level
  msg: string
  ctx?: Ctx
  trace?: string
  session_label?: string
}

const MAX_BUFFER = 10_000
const FLUSH_MS = 250
const RETRY_MS = 1_000
const FLUSH_COUNT = 64
const MAX_BATCH = 1_000 // server-side limit per request

interface State {
  url: string
  source: string
  sessionId: string
  buffer: WireEvent[]
  dropped: number
  timer: ReturnType<typeof setTimeout> | null
  labelPending: string | undefined
  warned: boolean
  flushing: boolean
}

let state: State | null = null
let listenersInstalled = false

export function initDeblog(opts: InitOptions): { sessionId: string } {
  if (opts.enabled === false) {
    state = null
    return { sessionId: opts.sessionId ?? '' }
  }
  state = {
    url: (opts.url ?? 'http://127.0.0.1:4600').replace(/\/+$/, ''),
    source: opts.source,
    sessionId: opts.sessionId ?? generateSessionId(),
    buffer: [],
    dropped: 0,
    timer: null,
    labelPending: opts.sessionLabel,
    warned: false,
    flushing: false,
  }
  if (!listenersInstalled) {
    listenersInstalled = true
    if (typeof document !== 'undefined') {
      // pagehide + visibilitychange are the reliable teardown signals;
      // unload/beforeunload are not.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') beaconFlush()
      })
      addEventListener('pagehide', () => beaconFlush())
    } else if (typeof process !== 'undefined' && typeof process.on === 'function') {
      process.on('beforeExit', () => {
        void flush()
      })
    }
  }
  return { sessionId: state.sessionId }
}

/** Time-sortable id: base36 epoch-ms + 12 random base36 chars. */
export function generateSessionId(): string {
  let r = ''
  for (let i = 0; i < 12; i++) r += Math.floor(Math.random() * 36).toString(36)
  return `${Date.now().toString(36)}-${r}`
}

export function createLog(ns: string): Logger {
  return makeLogger(ns, undefined)
}

function makeLogger(ns: string, trace: string | undefined): Logger {
  const emit =
    (level: Level) =>
    (msg: string, ctx?: Ctx): void => {
      const s = state
      if (!s) return // disabled: one boolean-ish check, no allocation
      const ev: WireEvent = { ts: Date.now(), session_id: s.sessionId, source: s.source, ns, level, msg }
      if (ctx !== undefined) ev.ctx = ctx
      if (trace !== undefined) ev.trace = trace
      enqueue(s, ev)
    }
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    withTrace: (t: string) => makeLogger(ns, t),
  }
}

function enqueue(s: State, ev: WireEvent): void {
  if (s.labelPending !== undefined) {
    ev.session_label = s.labelPending
    s.labelPending = undefined
  }
  if (s.buffer.length >= MAX_BUFFER) {
    s.buffer.shift()
    s.dropped++
  }
  s.buffer.push(ev)
  if (s.buffer.length >= FLUSH_COUNT) {
    void flush()
  } else {
    scheduleFlush(s, FLUSH_MS)
  }
}

function scheduleFlush(s: State, ms: number): void {
  if (s.timer !== null) return
  s.timer = setTimeout(() => {
    s.timer = null
    void flush()
  }, ms)
  ;(s.timer as { unref?: () => void }).unref?.()
}

/** Serialize events individually so one non-serializable ctx (circular ref,
    BigInt) cannot throw into the host app or wedge the whole buffer. */
function serializeBatch(batch: WireEvent[]): { body: string | null; poison: number } {
  const parts: string[] = []
  let poison = 0
  for (const ev of batch) {
    try {
      parts.push(JSON.stringify(ev))
    } catch {
      poison++
    }
  }
  return { body: parts.length > 0 ? `[${parts.join(',')}]` : null, poison }
}

/** Force-send everything buffered. Never throws. */
export async function flush(): Promise<void> {
  const s = state
  if (!s || s.flushing) return
  if (s.timer !== null) {
    clearTimeout(s.timer)
    s.timer = null
  }
  if (s.buffer.length === 0) return
  s.flushing = true
  try {
    while (s.buffer.length > 0) {
      const batch = s.buffer.slice(0, MAX_BATCH)
      const { body, poison } = serializeBatch(batch)
      if (body !== null) {
        const res = await fetch(`${s.url}/v1/log`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
        if (!res.ok) throw new Error(`server responded ${res.status}`)
      }
      s.buffer.splice(0, batch.length)
      s.dropped += poison
      s.warned = false
      if (s.dropped > 0) {
        const n = s.dropped
        s.dropped = 0
        s.buffer.push({
          ts: Date.now(),
          session_id: s.sessionId,
          source: s.source,
          ns: 'deblog',
          level: 'warn',
          msg: `dropped ${n} events (client buffer full while server unreachable)`,
        })
      }
    }
  } catch (err) {
    if (!s.warned) {
      s.warned = true
      console.warn(`[deblog] log server unreachable, buffering (drop-oldest beyond ${MAX_BUFFER}):`, (err as Error).message)
    }
    scheduleFlush(s, RETRY_MS) // events stay buffered; retry later
  } finally {
    s.flushing = false
  }
}

function beaconFlush(): void {
  try {
    const s = state
    if (!s || s.buffer.length === 0) return
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
    // A string body is a "simple" text/plain request — no CORS preflight, which
    // sendBeacon cannot perform. The server parses text/plain as JSON for this.
    const batch = s.buffer.slice(0, MAX_BATCH)
    const { body } = serializeBatch(batch)
    if (body !== null) navigator.sendBeacon(`${s.url}/v1/log`, body)
    s.buffer.splice(0, batch.length)
  } catch {
    // never throw into the host app
  }
}

/** Test hook: clear module state. */
export function _resetForTests(): void {
  if (state?.timer != null) clearTimeout(state.timer)
  state = null
}
