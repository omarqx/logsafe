/** Plugin contract major version. Core refuses a plugin whose manifest
 *  apiVersion major differs from this. */
export const PLUGIN_API_VERSION = '1' as const

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A normalized event before insert: parsed ctx, resolved type, and the
 *  original ingest object (for matchers). */
export interface IncomingEvent {
  readonly session_id: string
  readonly ts: number
  readonly received_at: number
  readonly source: string
  readonly ns: string
  readonly level: LogLevel
  readonly msg: string
  readonly ctx: unknown
  readonly trace: string | null
  readonly type: string
  readonly raw: Readonly<Record<string, unknown>>
}

/** Post-insert event: core StoredEvent + type, seq assigned. */
export interface StoredEvent {
  readonly seq: number
  readonly session_id: string
  readonly ts: number
  readonly received_at: number
  readonly source: string
  readonly ns: string
  readonly level: LogLevel
  readonly msg: string
  readonly ctx: unknown
  readonly trace: string | null
  readonly type: string
}

/** SQLite handle scoped to one plugin. `table()` enforces the naming seam. */
export interface PluginDb {
  exec(sql: string): void
  prepare<Row = unknown>(sql: string): {
    all(...p: unknown[]): Row[]
    get(...p: unknown[]): Row | undefined
    run(...p: unknown[]): { changes: number }
  }
  transaction<T>(fn: () => T): () => T
  /** `table('views')` → `'plugin_<id>_views'`. Use for every CREATE/SELECT. */
  table(name: string): string
}

export interface ServerPluginContext {
  readonly pluginId: string
  readonly db: PluginDb
  log(msg: string): void
}

export type PluginRouteHandler = (req: {
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}) => unknown | Promise<unknown>

/** Every route is mounted at /api/plugins/<id><path>. */
export interface PluginRouter {
  get(path: string, handler: PluginRouteHandler): void
  post(path: string, handler: PluginRouteHandler): void
}

export interface ServerPlugin {
  matchType?(event: IncomingEvent): string | null
  transform?(event: IncomingEvent): IncomingEvent | void
  afterInsert?(events: StoredEvent[], ctx: ServerPluginContext): void
  migrate?(ctx: ServerPluginContext): void
  routes?(router: PluginRouter, ctx: ServerPluginContext): void
  onSessionDelete?(sessionId: string, ctx: ServerPluginContext): void
  setup?(ctx: ServerPluginContext): void | Promise<void>
  teardown?(ctx: ServerPluginContext): void | Promise<void>
}

export interface PluginManifest {
  id: string
  version: string
  apiVersion: string
  ownedTypes: string[]
  priority?: number
  /** Module specifiers for the entries, relative to the plugin package. */
  server?: string
  ui?: string
}
