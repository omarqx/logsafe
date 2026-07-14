import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fastifyStatic from '@fastify/static'
import { openDb } from './db.js'
import { buildApp } from './app.js'
import { pruneSessions } from './retention.js'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    console.warn(`[deblog] invalid ${name}="${raw}", using default ${fallback}`)
    return fallback
  }
  return n
}

const PORT = envNumber('PORT', 4600)
const DB_PATH = process.env.DEBLOG_DB ?? path.join(os.homedir(), '.deblog', 'deblog.db')
const RETENTION_DAYS = envNumber('RETENTION_DAYS', 7)

const db = openDb(DB_PATH)
const app = buildApp({ db })

const publicDir = path.join(import.meta.dirname, '..', 'public')
if (fs.existsSync(publicDir)) {
  app.register(fastifyStatic, { root: publicDir })
}

function safePrune(): void {
  try {
    const pruned = pruneSessions(db, RETENTION_DAYS, Date.now())
    if (pruned > 0) console.log(`[deblog] retention: pruned ${pruned} session(s) older than ${RETENTION_DAYS}d`)
  } catch (err) {
    console.error('[deblog] retention prune failed (will retry next interval):', (err as Error).message)
  }
}

safePrune()
setInterval(safePrune, 3_600_000).unref()

const address = await app.listen({ host: '127.0.0.1', port: PORT })
console.log(`[deblog] listening on ${address}  (db: ${DB_PATH}, retention: ${RETENTION_DAYS}d)`)
