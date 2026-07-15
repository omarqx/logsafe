// serve.ts — the `logsafe` server process. Extracted from the old index.ts
// so the CLI can route subcommands; behavior is identical.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { openDb } from './db.js'
import { buildApp } from './app.js'
import { registerSpa } from './spa.js'
import { registerMcpHttp } from './mcp-http.js'
import { pruneSessions } from './retention.js'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    console.warn(`[logsafe] invalid ${name}="${raw}", using default ${fallback}`)
    return fallback
  }
  return n
}

export async function serve(): Promise<void> {
  const PORT = envNumber('PORT', 4600)
  // Bind loopback-only by default (safe). Override with LOGSAFE_HOST=0.0.0.0
  // to accept log ingest from other hosts/containers (e.g. a dockerized app
  // logging to the host). The /mcp endpoint keeps its own loopback-only guard
  // regardless, so widening the bind opens ingest, not the agent interface.
  const HOST = process.env.LOGSAFE_HOST ?? '127.0.0.1'
  const DB_PATH = process.env.LOGSAFE_DB ?? path.join(os.homedir(), '.logsafe', 'logsafe.db')
  const RETENTION_DAYS = envNumber('RETENTION_DAYS', 7)

  const db = openDb(DB_PATH)
  const app = buildApp({ db })

  const publicDir = path.join(import.meta.dirname, '..', 'public')
  if (fs.existsSync(publicDir)) {
    await registerSpa(app, publicDir)
  }

  const SELF_BASE = `http://127.0.0.1:${PORT}`
  registerMcpHttp(app, SELF_BASE)

  function safePrune(): void {
    try {
      const pruned = pruneSessions(db, RETENTION_DAYS, Date.now())
      if (pruned > 0) console.log(`[logsafe] retention: pruned ${pruned} session(s) older than ${RETENTION_DAYS}d`)
    } catch (err) {
      console.error('[logsafe] retention prune failed (will retry next interval):', (err as Error).message)
    }
  }

  safePrune()
  setInterval(safePrune, 3_600_000).unref()

  const address = await app.listen({ host: HOST, port: PORT })
  console.log(`[logsafe] listening on ${address}  (bind: ${HOST}, db: ${DB_PATH}, retention: ${RETENTION_DAYS}d)`)
  console.log(`[logsafe] MCP endpoint: ${address}/mcp`)
}
