# logsafe-client

Zero-dependency logging client for [logsafe](https://github.com/omarqx/logsafe):
batched HTTP delivery, `sendBeacon` unload flush, never throws into the host
app.

## Install

```bash
npm i logsafe-client
```

## Usage

```ts
import { initLogsafe, createLog } from 'logsafe-client'

const { sessionId } = initLogsafe({
  source: 'webapp',              // required: identifies this process/app
  sessionLabel: 'checkout flow', // optional, human-readable
  // url: 'http://127.0.0.1:4600' (default)
})

const log = createLog('cart')    // ns: a dotted/colon namespace for this logger
log.info('cart hydrated', { items: 3, total_cents: 8497 })
log.error('payment failed', { status: 502 })

// Follow one request/operation across sources by sharing a trace id:
const reqLog = createLog('cart:payment').withTrace(`req-${sessionId.slice(0, 6)}`)
reqLog.info('submitting payment', { provider: 'stripe' })
```

Events are buffered and flushed automatically (every 250ms, or immediately
at 64 buffered events), and flushed on page unload via `sendBeacon`. Call
`flush()` to force-send (useful before a script exits, e.g. in tests or a
CLI tool).

## Server

This client needs a logsafe server to send events to. The server is the
`logsafe` package:

```bash
npx logsafe
```

## Docs

Full docs, including the frozen HTTP contract (`API.md`), are at
https://github.com/omarqx/logsafe.
