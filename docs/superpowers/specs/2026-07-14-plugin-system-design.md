# logsafe plugin system — design

> **Status:** design only (Phase 1). No implementation. The deliverable is the
> plugin contract: the mechanical install/discovery model and the concrete
> TypeScript interfaces for the server and UI, plus a "hello world" walkthrough.
> The video/PSDK plugin is **not** built here — its seams are called out so it
> drops in cleanly later.
>
> Decisions locked with the author (2026-07-14):
> - **UI loading:** build-time registry (config-driven codegen compiled by Vite).
> - **Type model:** per-event `type` + derived per-session "view owner".
> - **SDK:** a standalone published package, `@coglet/logsafe-plugin-sdk`.

---

## 1. Goals and non-goals

**Goal.** Let a plugin register a *log type* and, for sessions carrying that
type, override (a) the session **list row**, (b) the session **detail view**,
and optionally (c) **ingest shaping** (parse/normalize/enrich) and (d) **derived
data + its own API routes** — all without forking core.

**Non-goals (this phase).**
- No video/Mux/PSDK code. Only the generic system.
- No third-party *runtime* UI drop-in (no module federation). Build-time only;
  the contract is shaped so a runtime loader can be added later without changing
  plugin code.
- No auth, no multi-tenant isolation — logsafe stays a local `127.0.0.1` tool.

**The one hard constraint that shapes everything:** the UI ships as a
**prebuilt Vite bundle** served statically from `packages/server/public`
(`ui/vite.config.ts` → `outDir`). The server is a live Node process and can load
plugins at runtime; the UI cannot. So the install story is **asymmetric** and we
say so plainly (§5).

---

## 2. The type model

### 2.1 Type is per-event; the session's "view owner" is derived

A scalar `type` on the session cannot represent the motivating case — a video
session with **both** generic app logs **and** player telemetry. So:

- Every event gets a `type` string. Default `"generic"`. A plugin *owns* one or
  more type strings (`ownedTypes` in its manifest).
- A session carries a **derived set** of the distinct types present, stored
  denormalized as `types: string[]` (exactly how `sources` is already
  maintained in `insertBatch`, see `packages/server/src/ingest.ts`).
- The **view owner** of a session — the single plugin that renders its list row
  and detail screen — is resolved: *the highest-`priority` installed plugin
  whose `ownedTypes` intersect `session.types`*; ties broken by manifest order;
  no match → generic (flat view). This is a pure function of `session.types` +
  the installed registry, computed identically on server and client.

A mixed session (`types: ["generic","psdk"]`) therefore opens the **psdk**
detail view (higher priority), and *that view* chooses to render the core flat
log underneath its timeline (§8, §7.4). The core never needs to know about
video.

### 2.2 How an event's type is decided (ingest)

Resolution order, first hit wins, evaluated per event during normalization:

1. **Explicit** `type` field on the ingest object (a non-empty string). Most
   predictable; recommended for producers that control their payload.
2. **Plugin matcher.** Each `ServerPlugin.matchType(event)` is called in
   descending `priority` order; the first non-null return is the type. This
   subsumes the "per-source mapping" and "ns-prefix routing" ideas from the
   brief — a plugin implements either inside its matcher (e.g.
   `e.ns.startsWith("player:") ? "psdk" : null`) — so the core stays dumb and
   the plugin stays in control.
3. **Fallback** `"generic"`.

Trade-offs rejected: making *source→type* or *ns→type* first-class core config
would freeze routing policy into core and duplicate what a matcher already
expresses. Keep one mechanism.

### 2.3 Where it's stored (schema)

Additive, backward-compatible migration (no migration framework exists today —
`db.ts` runs `CREATE TABLE IF NOT EXISTS`; we add idempotent `ALTER TABLE … ADD
COLUMN` guarded by a PRAGMA check):

```sql
ALTER TABLE events   ADD COLUMN type  TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE sessions ADD COLUMN types TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, type);
```

Existing rows read back as `type: 'generic'` / `types: []` — no data migration
needed. Plugin-owned tables live **outside** these (§6.3).

### 2.4 API contract amendment (breaks the "FROZEN" note in API.md)

This is a real freeze-break and must be recorded as a versioned addition, not
slipped in:

- `StoredEvent` gains `type: string` (everywhere it appears: events query,
  export.ndjson, SSE frames).
- `SessionSummary` gains `types: string[]`.
- A new reserved route namespace `/api/plugins/<id>/*` is documented as
  plugin-owned (core never serves under it directly).
- `POST /v1/log` documents the optional `type` field with the resolution order
  from §2.2.

All additive; existing clients ignore unknown fields. `API.md` gets a dated
version note.

---

## 3. What a plugin *is*, mechanically

A plugin is an **npm package** (or a folder under a `plugins/` dir — same shape)
with a manifest and up to two entry modules:

```
logsafe-plugin-hello/
  package.json          ← contains the "logsafe" manifest field
  server.js  (+ .d.ts)  ← default-exports a ServerPlugin   (optional)
  ui.js      (+ .d.ts)  ← default-exports a UIPlugin        (optional)
```

The manifest is a `"logsafe"` field in `package.json` (resolvable for both
npm-installed and dropped-in packages):

```jsonc
{
  "name": "logsafe-plugin-hello",
  "version": "0.0.1",
  "logsafe": {
    "id": "hello",           // stable; also the URL + table namespace. kebab-case.
    "apiVersion": "1",        // plugin-contract major this targets (§10)
    "ownedTypes": ["hello"],  // event types claimed + rendered
    "priority": 10,           // higher wins session view ownership; default 0
    "server": "./server.js",  // omit if UI-only
    "ui": "./ui.js"           // omit if server-only
  }
}
```

Either entry may be absent: a server-only plugin (pure ingest shaping / metrics
API) ships no `ui`; a UI-only plugin (re-skin an existing type) ships no
`server`.

---

## 4. The SDK package

`packages/plugin-sdk`, published as **`@coglet/logsafe-plugin-sdk`**, with two
subpath exports so a plugin pulls in only what it needs and core + the external
video plugin share one source of truth (drift impossible — core *consumes* the
SDK too):

- `@coglet/logsafe-plugin-sdk/server` — manifest + server-hook types, the
  `PluginDb`/`PluginRouter`/`ServerPluginContext` facades. Zero runtime deps.
- `@coglet/logsafe-plugin-sdk/ui` — React prop/interface types, plus the
  **runtime-access hooks/components** (`useSessionEvents`, `FlatLogView`,
  `useCoreApi`, `usePluginFetch`) that read a core-provided React context (§7.5).

The SDK depends on **nothing in core**; core and plugins depend on the SDK. That
dependency direction is what keeps the contract stable while core internals
churn.

---

## 5. Discovery, registration, install

### 5.1 Config

One file at the server's working dir (or `LOGSAFE_CONFIG` path):

```jsonc
// logsafe.config.json
{ "plugins": ["logsafe-plugin-hello", "@acme/logsafe-plugin-psdk", "./plugins/local-thing"] }
```

Entries resolve like Node module specifiers (bare = `node_modules`, relative =
path). Absent config ⇒ zero plugins ⇒ today's exact behavior.

### 5.2 Server side — **runtime**

In `serve.ts`, before `app.listen`:

1. Read config, resolve each specifier, read its `package.json#logsafe`.
2. Reject/skip on `apiVersion` major mismatch (log a clear line).
3. `import()` the `server` entry (if any); collect its default `ServerPlugin`.
4. Sort by `priority` desc → this order drives `matchType` and view-owner
   resolution everywhere.
5. `migrate(ctx)` then `await setup(ctx)` for each.
6. Mount each plugin's `routes()` under `/api/plugins/<id>/`.
7. Wire `afterInsert` and `onSessionDelete` into the ingest / delete / prune
   paths (§6).

This is a true "drop the package in, edit config, restart the server" loop for
**all server-side capability** (ingest shaping, metrics, routes).

### 5.3 UI side — **build-time**

Because the SPA is prebuilt, UI contribution is compiled in:

1. A codegen step (`logsafe plugins:sync`, run by `logsafe build`) reads the same
   config and writes `ui/src/plugins.generated.ts`:

   ```ts
   // AUTO-GENERATED — do not edit
   import hello from 'logsafe-plugin-hello/ui'
   import psdk from '@acme/logsafe-plugin-psdk/ui'
   export const uiPlugins = [hello, psdk] as const
   ```

2. `vite build` tree-shakes and bundles them into `public/`.

So the UI install loop is "edit config, run `logsafe build`, restart." One extra
command vs. the server. We accept this: the primary audience builds their own
plugins, and it buys full type-safety, tree-shaking, and zero runtime module
risk. **The plugin author writes identical code either way** — only *how core
discovers the UI entry* differs — so a future runtime loader (dynamic
`import()` of `public/plugins/<id>.js`) is an additive core change, not a
contract change.

---

## 6. Server contract

```ts
// @coglet/logsafe-plugin-sdk/server

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A normalized event before insert (mirrors core NormalizedEvent, parsed ctx,
 *  plus the resolved type and the original ingest object for matchers). */
export interface IncomingEvent {
  readonly session_id: string
  readonly ts: number
  readonly received_at: number
  readonly source: string
  readonly ns: string
  readonly level: LogLevel
  readonly msg: string
  readonly ctx: unknown                       // parsed, not JSON text
  readonly trace: string | null
  readonly type: string                        // resolved type ('generic' if unclaimed)
  readonly raw: Readonly<Record<string, unknown>> // original ingest object
}

/** Post-insert event: core StoredEvent + type. seq assigned. */
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

/** SQLite handle scoped to this plugin. Real isolation is impossible in a
 *  single SQLite file, so the seam is a naming convention + a helper:
 *  every plugin table MUST be named `plugin_<id>_<name>`; `table()` builds it. */
export interface PluginDb {
  exec(sql: string): void
  prepare<Row = unknown>(sql: string): { all(...p: unknown[]): Row[]; get(...p: unknown[]): Row | undefined; run(...p: unknown[]): { changes: number } }
  transaction<T>(fn: () => T): () => T
  /** `table('views')` → `'plugin_hello_views'`. Use for every CREATE/SELECT. */
  table(name: string): string
}

export interface ServerPluginContext {
  readonly pluginId: string
  readonly db: PluginDb
  log(msg: string): void
}

/** Fastify-thin router; every route is mounted at /api/plugins/<id><path>. */
export interface PluginRouter {
  get(path: string, handler: PluginRouteHandler): void
  post(path: string, handler: PluginRouteHandler): void
}
export type PluginRouteHandler = (req: {
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}) => unknown | Promise<unknown>   // returned value is JSON-serialized (200)

export interface ServerPlugin {
  /** Claim an untyped event. Return the owned type string, or null to pass.
   *  Called in priority order; first non-null wins. Pure; no side effects. */
  matchType?(event: IncomingEvent): string | null

  /** Enrich/reshape a claimed event before insert (mutate ns/level/ctx/msg,
   *  add derived ctx). Return a patched copy, or void to keep as-is. Only
   *  called for events whose resolved type ∈ ownedTypes. */
  transform?(event: IncomingEvent): IncomingEvent | void

  /** After a batch is inserted (seqs assigned). Compute derived state and
   *  write it to plugin tables. Only receives events whose type ∈ ownedTypes,
   *  already grouped per session_id by the caller. Runs inside the ingest tick;
   *  keep it fast or defer heavy work. */
  afterInsert?(events: StoredEvent[], ctx: ServerPluginContext): void

  /** Create/upgrade plugin-owned tables. Idempotent; runs once at startup. */
  migrate?(ctx: ServerPluginContext): void

  /** Register HTTP routes under /api/plugins/<id>/. */
  routes?(router: PluginRouter, ctx: ServerPluginContext): void

  /** A core session was deleted (DELETE endpoint) or pruned (retention).
   *  Delete the plugin's rows for it. Core calls this inside the same
   *  transaction that removes core rows. */
  onSessionDelete?(sessionId: string, ctx: ServerPluginContext): void

  setup?(ctx: ServerPluginContext): void | Promise<void>
  teardown?(ctx: ServerPluginContext): void | Promise<void>
}
```

### 6.1 Ingest pipeline changes (where hooks plug in)

Today: `POST /v1/log` → `normalizeEvent(raw, t)` → `insertBatch` → `afterInsert`
(SSE publish) in `app.ts`. New pipeline, per event:

```
raw → normalizeEvent → resolveType(raw, normalized, plugins)
    → (owning plugin).transform?  → NormalizedEvent{…, type}
insertBatch (writes type column, maintains sessions.types set)
    → for each plugin: plugin.afterInsert(itsEvents, ctx)   // derived metrics
    → hub.publish (SSE)                                       // unchanged
```

`resolveType` applies §2.2. `insertBatch` gains the `type` column and updates
`sessions.types` the same way it updates `sources`.

### 6.2 Query contribution

Plugins contribute **their own routes** (`routes()` → `/api/plugins/<id>/*`)
rather than extending core response shapes. Extending core JSON in place would
recouple core to plugin fields and re-break the API contract per plugin; a
separate namespace keeps core responses stable and the plugin's surface
self-describing. The video plugin's `GET /api/plugins/psdk/views/:id` is exactly
this.

### 6.3 Table coexistence, isolation, joinability

- **Coexistence without core knowledge:** each plugin creates its tables in
  `migrate()` using `ctx.db.table(name)` → `plugin_<id>_<name>`. Core's
  `CREATE TABLE IF NOT EXISTS` never touches them; the prefix guarantees no
  collision.
- **Isolation:** convention-enforced (SQLite has no per-schema namespaces in one
  file). `PluginDb.table()` + review is the seam. Documented as "soft" isolation
  — a plugin *can* read core tables (useful: join to `events` by `session_id`)
  but must only *write* its own.
- **Joinability:** plugin rows key on `session_id` (and `seq` when they annotate
  specific events) — foreign-key-by-convention to core `sessions`/`events`. Not
  enforced FKs, because retention/delete already cascade manually; instead core
  calls `onSessionDelete` inside the delete/prune transaction so plugin rows die
  with the session (fixes the otherwise-orphaned-rows bug — see `deleteSession`
  and `pruneSessions`, which currently only touch core tables).

---

## 7. Client contract

```ts
// @coglet/logsafe-plugin-sdk/ui
import type { ComponentType } from 'react'

export interface SessionSummary {   // core shape + types
  id: string; label: string | null
  first_ts: number; last_ts: number; duration_ms: number
  status: 'active' | 'idle'
  event_count: number; error_count: number; warn_count: number
  sources: string[]
  types: string[]                    // NEW
}
export interface StoredEvent {       // core shape + type
  seq: number; session_id: string; ts: number; received_at: number
  source: string; ns: string
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string; ctx: unknown; trace: string | null
  type: string                       // NEW
}
export interface EventsPage { events: StoredEvent[]; next_after_seq: number | null }

/** The core query client (relative-URL fetch, same as ui/src/api.ts). */
export interface CoreApi {
  fetchEventsPage(sessionId: string, params: URLSearchParams, afterSeq?: number, limit?: number): Promise<EventsPage>
  getSession(id: string): Promise<SessionSummary | null>
  exportUrl(sessionId: string, params: URLSearchParams): string   // href for export.ndjson
}

/** Scoped fetch to /api/plugins/<id>/… (JSON in, parsed JSON out). */
export type PluginFetch = <T = unknown>(path: string, init?: RequestInit) => Promise<T>

/** Theme is CSS custom properties (ui/src/theme.css). Plugins mostly just use
 *  var(--phos) etc. in their own styles; `tokens` is a typed convenience map
 *  of the same values for inline styling / canvas / charts. */
export interface ThemeTokens {
  bg: string; bgRaise: string; txt: string; dim: string; faint: string; line: string
  phos: string; amber: string; err: string
  sources: string[]                  // the 6 source-slot colors, in order
  rowH: string
}

export interface ListRowProps {
  session: SessionSummary
  now: number
  selected: boolean
  onOpen(): void                     // navigate to /s/:id
  onSelect(): void                   // set keyboard selection (j/k)
  api: CoreApi
  pluginFetch: PluginFetch
}

export interface DetailViewProps {
  session: SessionSummary | null     // null until the summary poll returns
  sessionId: string
  api: CoreApi
  pluginFetch: PluginFetch
  /** URL is the single source of truth (see SessionDetailPage). A plugin view
   *  can read/write it to deep-link its own state (selected view, zoom, etc.). */
  urlState: {
    params: URLSearchParams
    setParams(next: URLSearchParams, opts?: { replace?: boolean }): void
  }
  tokens: ThemeTokens
}

/** What a plugin default-exports from its ui entry. */
export interface UIPlugin {
  type: string                       // primary owned type (matches manifest)
  ListRow?: ComponentType<ListRowProps>
  DetailView?: ComponentType<DetailViewProps>
}
```

### 7.1 Reusing core UI — `FlatLogView` and `useSessionEvents`

Two things the brief requires a plugin to reuse: the **flat log component** and
the **live SSE stream**. Rather than prop-drill a hook (awkward under the rules
of hooks) or export core internals from the SDK (wrong dependency direction),
the SDK exposes them as **importable hooks/components backed by a core-provided
React context** (§7.5):

```ts
// @coglet/logsafe-plugin-sdk/ui  (importable from inside a plugin component)

/** The core flat, filterable, virtualized log view — drop it under a timeline
 *  to compose (§8). Extracted from SessionDetailPage as part of this work. */
export const FlatLogView: ComponentType<FlatLogViewProps>
export interface FlatLogViewProps {
  sessionId: string
  session: SessionSummary | null
  /** Constrain what the flat view shows, e.g. only generic logs beneath a
   *  timeline, or a specific ns. Defaults to all events. */
  baseFilters?: { ns?: string; level?: string; source?: string; type?: string }
}

/** The core live-tail hook: progressive page load + filtered SSE tail + pins,
 *  same semantics/backpressure as SessionDetailPage. Stable facade over the
 *  internal useEventStream. */
export function useSessionEvents(sessionId: string, filters?: URLSearchParams): {
  events: StoredEvent[]
  loading: boolean
  tail: 'live' | 'paused'
  pause(): void
  resume(): void
  error: string | null
}
```

### 7.2 Why a context, not exports from core

`FlatLogView`/`useSessionEvents` need the *live* core implementation, but the
SDK must not import core (that would invert the dependency and break the
external video plugin's build). So:

- The SDK defines a `LogsafeRuntimeContext` and the thin wrappers above, which
  read the implementation out of that context.
- Core renders `<LogsafeRuntimeProvider value={{ FlatLogView: RealFlatLogView,
  useEventStream: realHook, api, makePluginFetch }}>` at the app root.
- A plugin just `import { FlatLogView, useSessionEvents } from
  '@coglet/logsafe-plugin-sdk/ui'` — no core dependency, fully typed.

### 7.3 Registry resolution (list + detail)

Core builds `Map<type, UIPlugin>` from `uiPlugins` (the generated array),
ordered by manifest priority. One shared resolver:

```ts
// core (not SDK)
function resolveViewOwner(session: SessionSummary): UIPlugin | undefined
// highest-priority installed UIPlugin whose `type` ∈ session.types; else undefined
```

- **`SessionListPage`** (`ui/src/routes/SessionListPage.tsx`): for each session,
  `const owner = resolveViewOwner(s)`; render `owner?.ListRow ?? DefaultRow`.
  The default row is today's markup, extracted into `<DefaultSessionRow>`.
- **`SessionDetailPage`** becomes a **dispatcher**: `const owner =
  resolveViewOwner(session)`; render `owner?.DetailView ?? <FlatLogView>`. All
  of today's flat-view logic moves into the extracted `FlatLogView`.

### 7.4 The list-row grid constraint (a real gotcha, called out)

The list is a CSS grid with fixed columns (`.cols`/`.row` in `theme.css`). A
plugin `ListRow` renders **one full row** and has full control of its own
internal layout, but to line up with the header columns it should either reuse
`DefaultSessionRow` and add/replace cells, or opt out of the grid (render its
own flex row spanning the track). The `hello` example (§9) does the simplest
thing: renders `DefaultSessionRow` semantics plus a badge. The contract does
**not** try to let a plugin inject "just one cell" into core's grid — that
coupling (plugin markup must match core's exact column count/order) is exactly
the kind of brittle seam we're avoiding. Full-row ownership is the stable
boundary.

---

## 8. Fallbacks and mixed cases

| Case | Behavior |
|---|---|
| Unknown / no type (`types` empty or all `generic`) | `resolveViewOwner` → undefined → flat list row + flat detail. Today's behavior, unchanged. |
| Typed session, **plugin not installed** | `session.types` contains `"psdk"` but no UIPlugin owns it → falls back to flat view, with a **note banner**: "This session has *psdk* data; install the psdk plugin to see its view." (Core renders the banner; it knows the type string, just not how to render it.) |
| Server-side plugin present, UI absent (or vice-versa) | Independent. Server-only plugin still shapes ingest + serves routes with no custom UI (flat view). UI-only plugin re-skins a type whose events were typed by an explicit `type` field or another plugin's matcher. |
| **Mixed** generic + plugin data | View owner = highest-priority plugin (e.g. psdk). Its `DetailView` composes: plugin timeline on top, `<FlatLogView baseFilters={{ type: 'generic' }}/>` beneath. A shared time axis between the two is a *future* coordination point (both already key on `ts`); the contract doesn't force it now, but nothing blocks it. |
| `apiVersion` major mismatch | Plugin skipped at load with a logged reason; core runs without it. |

---

## 9. "Hello world" plugin — end to end

A trivial `hello` type: a badge in the list, a banner above the (still-present)
flat log in detail. Everything below is the *entire* plugin.

**`package.json`**
```jsonc
{
  "name": "logsafe-plugin-hello",
  "version": "0.0.1",
  "type": "module",
  "exports": { "./server": "./server.js", "./ui": "./ui.js" },
  "peerDependencies": { "@coglet/logsafe-plugin-sdk": "^1", "react": "^19" },
  "logsafe": {
    "id": "hello", "apiVersion": "1",
    "ownedTypes": ["hello"], "priority": 10,
    "server": "./server.js", "ui": "./ui.js"
  }
}
```

**`server.ts`** — claim events whose ns starts with `hello:`. No tables, no
routes; pure ingest classification.
```ts
import type { ServerPlugin } from '@coglet/logsafe-plugin-sdk/server'
const plugin: ServerPlugin = {
  matchType: (e) => (e.ns.startsWith('hello:') ? 'hello' : null),
}
export default plugin
```

**`ui.tsx`** — a badge and a banner; reuse the core flat view underneath.
```tsx
import type { UIPlugin, ListRowProps, DetailViewProps } from '@coglet/logsafe-plugin-sdk/ui'
import { FlatLogView } from '@coglet/logsafe-plugin-sdk/ui'

function HelloRow({ session, selected, onOpen, onSelect }: ListRowProps) {
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className="status active">●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span className="src src-0" style={{ color: 'var(--phos)' }}>
        👋 hello · {session.event_count} evts
      </span>
    </div>
  )
}

function HelloDetail({ session, sessionId }: DetailViewProps) {
  return (
    <>
      <div style={{ padding: '8px 20px', color: 'var(--phos)' }}>
        👋 Hello plugin — custom view for {session?.label ?? sessionId}
      </div>
      <FlatLogView sessionId={sessionId} session={session} />
    </>
  )
}

const plugin: UIPlugin = { type: 'hello', ListRow: HelloRow, DetailView: HelloDetail }
export default plugin
```

**Enable it** — `logsafe.config.json`:
```jsonc
{ "plugins": ["logsafe-plugin-hello"] }
```
Then: `logsafe build` (regenerates the UI registry + Vite build) and restart the
server. Now `POST /v1/log {"msg":"hi","ns":"hello:greet","session_id":"s1"}`
produces a `hello`-typed event; `s1` shows the 👋 badge in the list and the
banner-over-flat-log in detail.

**Minimum to add a new type that tweaks the row and swaps the detail view:** a
`package.json` manifest + a ~15-line `ui.tsx` (and, only if you need ingest
classification, a 3-line `server.ts`). No core changes.

---

## 10. Versioning and what stays stable

- **Frozen surface = the SDK types.** `ServerPlugin`, `UIPlugin`, `ListRowProps`,
  `DetailViewProps`, `PluginManifest`, and the `FlatLogView`/`useSessionEvents`
  facades. These are what the video plugin compiles against.
- **Not frozen = core internals.** `useEventStream`'s internals, the flat view's
  guts, route wiring — free to change as long as the facades hold.
- **`apiVersion`** in the manifest is the plugin-contract major. Core refuses a
  plugin whose major it doesn't implement. Additive changes bump minor (plugins
  keep working); breaking changes bump major (plugins opt in).

---

## 11. The PSDK / video seams (NOT built here)

Each seam below already exists in this contract; the video plugin fills it:

1. **Ingest normalization** — `matchType` claims Mux-style telemetry as `psdk`;
   `transform` normalizes it into core events (ns like `player:<viewId>`,
   structured `ctx`).
2. **Metrics tables + derived state** — `migrate` creates
   `plugin_psdk_views` / `plugin_psdk_metrics`; `afterInsert` computes per-view
   VST / rebuffer ratio / startup time and upserts them, keyed by `session_id`
   (+ a view id in `ctx`).
3. **Own routes** — `routes()` serves `GET /api/plugins/psdk/views/:id` (timeline
   + metrics) and `/views` (per-session list).
4. **Custom list row** — `ListRow` shows VST / rebuffer badges, fetching them via
   `pluginFetch('/views?session=' + id)`.
5. **Custom detail view replacing flat logs** — `DetailView` renders a Mux-like
   timeline (its own React/canvas), composing `<FlatLogView baseFilters={{ type:
   'generic' }}/>` beneath for the app logs. `priority` above generic makes a
   mixed session open this view.
6. **Session cleanup** — `onSessionDelete` drops the plugin's rows when a session
   is deleted or pruned.

Nothing in §11 requires a core change beyond what §12 already lists.

---

## 12. Core changes required to create these seams (this phase's build scope, later)

Enumerated so the implementation plan is unambiguous. **None of this is the
video plugin.**

**SDK (new)**
1. `packages/plugin-sdk` with `/server` and `/ui` subpath exports; the types
   above; the `LogsafeRuntimeContext` + `FlatLogView`/`useSessionEvents`
   facades; publish config for `@coglet/logsafe-plugin-sdk`.

**Server**
2. Schema: additive `type`/`types` columns + index + idempotent ALTER guard in
   `db.ts`.
3. Ingest: `resolveType` + plugin `transform` in the `normalize→insert` path;
   `insertBatch` writes `type` and maintains `sessions.types`; wire
   `afterInsert` hook after insert (alongside the existing SSE publish).
4. Plugin loader in `serve.ts`: config read, resolve, apiVersion check, `import`,
   `migrate`/`setup`, mount `routes` under `/api/plugins/<id>/`,
   `PluginDb`/`PluginRouter`/`ServerPluginContext` implementations.
5. `onSessionDelete` wired into `deleteSession` and `pruneSessions` transactions.
6. `API.md` amendment + dated version note (§2.4).

**Client**
7. Extract `FlatLogView` out of `SessionDetailPage` (the ~600 lines of flat-view
   logic) into a reusable component; `SessionDetailPage` becomes the dispatcher.
8. Extract `DefaultSessionRow` out of `SessionListPage`; list uses
   `resolveViewOwner`.
9. `resolveViewOwner` + the UI registry (`plugins.generated.ts`) + the codegen
   step (`logsafe plugins:sync`, invoked by `logsafe build`).
10. `<LogsafeRuntimeProvider>` at the app root supplying the runtime context.
11. `api.ts` gains `types`/`type` fields and `exportUrl`; a `pluginFetch`
    factory scoped to `/api/plugins/<id>`.
12. "Plugin not installed" note banner for typed-but-unowned sessions.

---

## 13. Open questions / risks

- **UI rebuild friction.** Build-time UI means adding a UI plugin needs
  `logsafe build`. Acceptable now (author builds own plugins); revisit a runtime
  loader if third-party drop-in becomes a real need. The plugin code doesn't
  change when we do.
- **`afterInsert` on the hot path.** It runs inside the ingest tick. Heavy metric
  computation should be bounded or deferred; the contract documents "keep it
  fast." A future async/queue variant is possible without changing the signature
  meaningfully.
- **Soft table isolation.** One SQLite file = convention, not enforcement. A
  buggy plugin *can* stomp core tables. Given the local-tool threat model, the
  `table()` helper + review is proportionate; documented, not hidden.
- **Shared time axis** between a plugin timeline and the flat view is deferred;
  both key on `ts`, so it's a later coordination feature, not a contract change.
