import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fastifyStatic from '@fastify/static'
import { openDb } from './db.js'
import { buildApp } from './app.js'
import { pruneSessions } from './retention.js'

const PORT = Number(process.env.PORT ?? 4600)
const DB_PATH = process.env.DEBLOG_DB ?? path.join(os.homedir(), '.deblog', 'deblog.db')
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 7)

const db = openDb(DB_PATH)
const app = buildApp({ db })

const publicDir = path.join(import.meta.dirname, '..', 'public')
if (fs.existsSync(publicDir)) {
  app.register(fastifyStatic, { root: publicDir })
}

const pruned = pruneSessions(db, RETENTION_DAYS, Date.now())
if (pruned > 0) console.log(`[deblog] retention: pruned ${pruned} session(s) older than ${RETENTION_DAYS}d`)
setInterval(() => pruneSessions(db, RETENTION_DAYS, Date.now()), 3_600_000).unref()

const address = await app.listen({ host: '127.0.0.1', port: PORT })
console.log(`[deblog] listening on ${address}  (db: ${DB_PATH}, retention: ${RETENTION_DAYS}d)`)
