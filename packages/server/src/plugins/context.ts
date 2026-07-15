import type { Db } from '../db.js'
import type { PluginDb, ServerPluginContext } from '@coglet/logsafe-plugin-sdk/server'

/** A PluginDb is just the core better-sqlite3 handle plus a `table()` helper
 *  that enforces the `plugin_<id>_` prefix. SQLite has no per-schema
 *  isolation in one file, so this is a naming seam, not a sandbox. */
function makePluginDb(db: Db, pluginId: string): PluginDb {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql) as never,
    transaction: <T>(fn: () => T) => db.transaction(fn),
    table: (name: string) => `plugin_${pluginId}_${name}`,
  }
}

export function makePluginContext(db: Db, pluginId: string): ServerPluginContext {
  return {
    pluginId,
    db: makePluginDb(db, pluginId),
    log: (msg: string) => console.log(`[logsafe:plugin:${pluginId}] ${msg}`),
  }
}
