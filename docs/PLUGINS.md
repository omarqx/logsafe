# Writing logsafe plugins

A plugin adds a new **event type** to logsafe: it can classify events at
ingest, derive and store its own metrics, serve its own API routes, and
render a custom list row / detail view for sessions carrying that type. The
core stays generic — plugins own everything type-specific.

Two tested examples ship in this repo — `examples/plugin-hello` (smallest
possible plugin: badge + banner, no tables, no routes) and
`examples/plugin-http` (full worked example: classification, a derived
table, routes, an SVG timeline) — plus a blank scaffold at
`templates/plugin-starter` to copy for a new plugin.

## 1. What a plugin is

A plugin is an npm package (or a local folder — same shape) with a
`"logsafe"` manifest in its `package.json` and up to two entry modules:

```
logsafe-plugin-http/
├── package.json   # "logsafe" manifest + peerDeps on the SDK and react
├── server.ts      # optional — ServerPlugin default export
├── ui.tsx         # optional — UIPlugin default export
└── timeline.ts    # (plugin-http only) pure helper imported by ui.tsx
```

`server` and `ui` are optional independently: a server-only plugin can
classify events and expose routes with no custom UI (flat-view fallback); a
UI-only plugin can re-skin a type another plugin (or an explicit `type`
field on ingest) already produces.

### The manifest

From `examples/plugin-http/package.json`:

```jsonc
{
  "name": "logsafe-plugin-http",
  "version": "0.1.0",
  "type": "module",
  "exports": { "./server": "./server.ts", "./ui": "./ui.tsx" },
  "peerDependencies": { "@coglet/logsafe-plugin-sdk": "*", "react": "^19" },
  "logsafe": {
    "id": "http", "version": "0.1.0", "apiVersion": "1",
    "ownedTypes": ["http"], "priority": 5,
    "server": "./server.ts", "ui": "./ui.tsx"
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique plugin id. Used for the naming seam (`plugin_<id>_*` tables), the route mount (`/api/plugins/<id>/*`), and `pluginFetch`'s base URL. |
| `version` | yes | Your plugin's own version (informational). |
| `apiVersion` | yes | Major version of the plugin contract this plugin targets. Core is currently `PLUGIN_API_VERSION = '1'`; a mismatched **major** skips the plugin at load (§6). |
| `ownedTypes` | yes | Type strings this plugin claims. Drives `afterInsert`/`transform` dispatch server-side and (for UI plugins) which `session.types` resolve to this plugin's views. |
| `priority` | no (default `0`) | Higher loads/matches first: matcher order at ingest, plugin load order, and (client-side) view-owner resolution when a session has more than one type. Ties break by manifest/config order. |
| `server` | no | Module specifier for the `ServerPlugin` default export, relative to the package. Omit for a UI-only plugin. |
| `ui` | no | Module specifier for the `UIPlugin` default export, relative to the package. Omit for a server-only plugin. |

### How an event's type is decided

Every event gets a `type` string (default `"generic"`). Resolution order,
first hit wins, evaluated per event at ingest (`packages/server/src/plugins/pipeline.ts`):

1. **Explicit `type` field** on the ingest payload — set by `normalizeEvent`
   if the producer sent one.
2. **Plugin matcher** — if still `"generic"`, each loaded plugin's
   `matchType(event)` is tried in **priority order**; the first non-null
   return wins.
3. **Fallback** — `"generic"`.

A session's `types: string[]` is the deduplicated set of types across its
events (maintained the same way `sources` already is).

### How the view owner is picked

A session's list row and detail view are rendered by its **view owner**: the
highest-`priority` **installed** plugin whose `ownedTypes` intersect
`session.types`; ties break by registry order; no match → the flat view.
`resolveViewOwner(session, registry)` (`ui/src/plugins/registry.ts`) is a
pure function of `session.types` + the installed UI registry, computed
identically server- and client-side. A mixed session (`types: ["generic",
"http"]`) opens the `http` plugin's detail view even though most of its
events are still `generic` — that view then decides whether/how to show the
generic events too (§4).

## 2. Install & enable

1. Add the package (a path or a package name) to `logsafe.config.json` at
   the repo root: `{ "plugins": ["./examples/plugin-http"] }`
2. Sync the UI registry — reads the config, resolves each entry's manifest,
   and writes the generated import list the web UI bundles: `npm run plugins:sync`
3. Rebuild the UI (the registry is compiled in, not loaded at runtime):
   `npm run build:ui`
4. Restart the server. It reloads `logsafe.config.json` itself (no sync
   step needed server-side) and logs what it found:
   ```
   [logsafe] loaded 1 plugin(s): http
   ```
   A plugin that fails to resolve, has an invalid manifest, or targets a
   different `apiVersion` major is skipped with a `[logsafe]` warning and
   logged reason — it never crashes the server.

If a session has a type no installed plugin owns (or no plugin is
installed at all), it falls back to the flat log view with a note banner
above it (`ui/src/routes/SessionDetailPage.tsx`):

> This session has **`<type>`** data. Install the `<type>` plugin to see
> its view — showing raw logs.

## 3. Server hooks

All hooks are optional; `ServerPlugin` (`@coglet/logsafe-plugin-sdk/server`)
is:

| Hook | When it runs / use it for |
|---|---|
| `matchType(event)` | Ingest, only while still `"generic"`, in priority order. Return a type string to claim, or `null` to pass. |
| `transform(event)` | Right after your type is assigned. Return a patched event, or nothing. |
| `migrate(ctx)` | Once at load, before `setup`. Create/upgrade your tables. |
| `setup(ctx)` | Once at load, after `migrate`. One-time init (may be async). |
| `afterInsert(events, ctx)` | Per insert batch, only events you own (`type ∈ ownedTypes`), grouped by session. Derive + persist metrics — **keep it fast** (ingest hot path). |
| `routes(router, ctx)` | Once at load. Register HTTP routes under your namespace. |
| `onSessionDelete(sessionId, ctx)` | On explicit delete, a `through_seq` purge that empties the session, or a retention prune. Clean up your rows. |
| `teardown(ctx)` | Reserved for future graceful-shutdown support. |

### `matchType` — classify events

From `examples/plugin-http/server.ts`:

```ts
const plugin: ServerPlugin = {
  matchType: (e) => (e.ns === 'http' || e.ns.startsWith('http:') ? 'http' : null),
}
```

### `transform` — patch a claimed event

`IncomingEvent.ctx` is the **parsed** value (not the raw JSON string stored
on disk) — read and return it as an object, and the core round-trips it
back to JSON for storage. Only the owning plugin's `transform` runs (the
plugin whose `ownedTypes` includes the resolved type):

```ts
const SLOW_MS = 1000

transform: (e) => {
  const r = e.ctx as Record<string, unknown> | null
  if (!r || typeof r.latency_ms !== 'number' || r.latency_ms <= SLOW_MS) return
  return { ...e, ctx: { ...r, slow: true } } // flags a slow request in the flat log's ctx
},
```

### `migrate` — your own tables, the `plugin_<id>_*` rule

`ctx.db.table(name)` prefixes with `plugin_<id>_` — **always** go through it
rather than hardcoding a table name, so plugins can never collide with core
tables or each other:

```ts
migrate: (ctx) => {
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS ${ctx.db.table('requests')} (
    session_id TEXT NOT NULL, trace TEXT NOT NULL, method TEXT, path TEXT,
    status INTEGER, latency_ms INTEGER, ts INTEGER NOT NULL,
    PRIMARY KEY (session_id, trace)
  )`)
},
```

`ctx.db.table('requests')` on a plugin with `id: "http"` resolves to
`"plugin_http_requests"`.

### `afterInsert` — derive metrics, keep it fast

Runs inline in the request that wrote the batch — it's on the ingest hot
path, so keep it fast; defer heavier/unbounded computation to your own
routes (computed on read) instead of doing it on every insert:

```ts
afterInsert: (events, ctx) => {
  const upsert = ctx.db.prepare(`
    INSERT INTO ${ctx.db.table('requests')} (session_id, trace, method, path, status, latency_ms, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, trace) DO UPDATE SET method = excluded.method, status = excluded.status
  `)
  for (const e of events) upsert.run(e.session_id, e.trace ?? String(e.seq), /* … */)
},
```

### `routes` — mounted under `/api/plugins/<id>/`

Every route you register is mounted at `/api/plugins/<id><path>` — core
never serves under that namespace itself, so it's entirely yours:

```ts
routes: (router, ctx) => {
  router.get('/summary/:sessionId', (req) => {
    const agg = ctx.db.prepare(
      `SELECT count(*) AS request_count FROM ${ctx.db.table('requests')} WHERE session_id = ?`,
    ).get(req.params.sessionId)
    return agg
  })
},
```

For plugin `http`, this becomes `GET /api/plugins/http/summary/:sessionId`.

### `onSessionDelete` — cleanup

Fires whenever a session's events disappear via any of three paths: an
explicit session delete, an events purge (`DELETE …/events?through_seq=`)
that happens to empty the session, or a retention prune (startup + hourly).
One plugin throwing here never blocks the others or the deletion itself —
the caller isolates and logs the failure per plugin.

```ts
onSessionDelete: (sessionId, ctx) => {
  ctx.db.prepare(`DELETE FROM ${ctx.db.table('requests')} WHERE session_id = ?`).run(sessionId)
},
```

## 4. UI recipes

`UIPlugin` (`@coglet/logsafe-plugin-sdk/ui`) is `{ type, ListRow?, DetailView? }`.
All plugin UI components render inside the app's `<LogsafeRuntimeProvider>`,
which is what makes `FlatLogView`, `useSessionEvents`, `useThemeTokens`, and
`usePluginFetch` resolve.

### Custom list row

`ListRowProps` gives you the session, selection state, and callbacks — you
own the **entire row**, not just a badge slot, so match the core row's
markup (`.row`, `.status`, `.label`) for visual consistency. From
`examples/plugin-hello/ui.tsx`:

```tsx
function HelloRow({ session, selected, onOpen, onSelect }: ListRowProps) {
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={() => { onSelect(); onOpen() }}>
      <span className="status active">●</span>
      <span className="label">{session.label ?? session.id}</span>
      <span className="src src-0" style={{ color: 'var(--phos)' }}>👋 hello · {session.event_count} evts</span>
    </div>
  )
}
```

Caveat: if your badge needs plugin-specific data (like `plugin-http`'s
request count), you're fetching it **per row** — every visible row runs its
own `pluginFetch` + polling loop (see below). Keep that payload small.

### Custom detail view + composing `FlatLogView`

The simplest detail view adds a banner above the core flat log
(`examples/plugin-hello/ui.tsx`):

```tsx
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
```

With no `baseFilters`, `FlatLogView` shows every event in the session
(generic and plugin-typed alike). To show only your own type's events
alongside a custom visual — or, for a mixed session, only the `generic`
events beneath your plugin's own summary of its typed ones — pass
`baseFilters`:

```tsx
<FlatLogView sessionId={sessionId} session={session} baseFilters={{ type: 'generic' }} />
```

`baseFilters` also accepts `ns`, `level`, and `source`; unset fields are not
constrained.

### Drawing a custom visual

`examples/plugin-http` draws an SVG request timeline with no chart library:
a pure geometry function (unit-testable, no React/DOM) plus a thin SVG
component that reads colors from `tokens`. Distilled from
`examples/plugin-http/timeline.ts` and `ui.tsx`:

```ts
// timeline.ts — pure layout, no React, unit-testable
export function layoutTimeline(requests: HttpRequestRow[], opts: { width: number; axisStart: number }) {
  const t0 = requests[0].ts
  const span = Math.max(1, requests[requests.length - 1].ts - t0)
  const axisWidth = opts.width - opts.axisStart
  const maxLatency = Math.max(1, ...requests.map((r) => r.latency_ms ?? 0))
  return requests.map((request, i) => ({
    request, y: i,
    x: opts.axisStart + ((request.ts - t0) / span) * axisWidth,
    width: Math.max(2, ((request.latency_ms ?? 0) / maxLatency) * axisWidth * 0.35),
  }))
}

export function barColor(r: HttpRequestRow, tokens: ThemeTokens): string {
  if (r.status !== null && r.status >= 500) return tokens.err
  if ((r.status !== null && r.status >= 400) || (r.latency_ms ?? 0) > 1000) return tokens.amber
  return tokens.phos
}
```

```tsx
// ui.tsx — SVG using layoutTimeline + tokens; click a bar -> urlState trace filter
<svg viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`} style={{ width: '100%' }} role="img">
  {rows.map((row) => (
    <rect key={row.request.trace} x={row.x} y={row.y * ROW_H} width={row.width} height={10}
      fill={barColor(row.request, tokens)} style={{ cursor: 'pointer' }}
      onClick={() => {
        const next = new URLSearchParams(urlState.params)
        next.set('trace', row.request.trace)
        urlState.setParams(next, { replace: false })
      }} />
  ))}
</svg>
```

Clicking a bar sets `?trace=<id>` through `urlState.setParams`, which the
core flat log underneath already filters on.

### Live events via `useSessionEvents`

For a plugin view that wants the raw live event stream itself (rather than
polling its own routes), the SDK exposes the same hook the core flat log
uses — pass a `URLSearchParams` as the second argument to scope it, the
same way `FlatLogView`'s `baseFilters` does internally:

```tsx
import { useSessionEvents } from '@coglet/logsafe-plugin-sdk/ui'

function LiveCount({ sessionId }: { sessionId: string }) {
  const { events, loading, tail } = useSessionEvents(sessionId)
  return <span>{loading ? '…' : `${events.length} events (${tail})`}</span>
}
```

### Fetching your own routes: `pluginFetch`

`pluginFetch` (a `ListRowProps`/`DetailViewProps` prop, or `usePluginFetch(id)`
from the SDK) is scoped to `/api/plugins/<id>/…`. The leading slash on the
path is optional, and the same function identity is returned per plugin id
on repeated calls, so it's safe in a `useEffect` deps array:

```tsx
const summary = await pluginFetch<Summary>(`/summary/${encodeURIComponent(sessionId)}`)
// equivalent: pluginFetch<Summary>(`summary/${encodeURIComponent(sessionId)}`)
```

### Theming

Don't hardcode colors — read them from the `tokens` prop (`DetailViewProps.tokens`,
or `useThemeTokens()`) so your view follows the app's theme. Each field maps
1:1 to a CSS custom property already defined by the core app
(`ui/src/runtime.tsx`); use either form interchangeably (`tokens.phos` or
`var(--phos)`):

| Token | CSS var | Token | CSS var |
|---|---|---|---|
| `bg` | `var(--bg)` | `phos` | `var(--phos)` |
| `bgRaise` | `var(--bg-raise)` | `amber` | `var(--amber)` |
| `txt` | `var(--txt)` | `err` | `var(--err)` |
| `dim` | `var(--dim)` | `rowH` | `var(--row-h)` |
| `faint` | `var(--faint)` | `sources` | per-source accents: `--cyan --violet --slate --gold --green --rose` |
| `line` | `var(--line)` | | |

## 5. Testing your plugin

Both shipped examples are tested with the same two patterns; copy whichever
fits.

**Rendering plugin UI components** needs a stub `LogsafeRuntimeProvider`
(components call `useCoreApi`/`useThemeTokens`/`FlatLogView`/etc., which
throw outside the provider). From `ui/src/test/httpPlugin.test.tsx`:

```tsx
const runtime: LogsafeRuntime = {
  api: { fetchEventsPage: async () => ({ events: [], next_after_seq: null }), getSession: async () => null, exportUrl: () => '' },
  makePluginFetch: () => (async () => ({})) as never,
  FlatLogView: () => <div>FLAT-LOG-STUB</div>,
  useSessionEvents: () => ({ events: [], loading: false, tail: 'live', pause() {}, resume() {}, error: null }),
  tokens: TOKENS,
}

render(
  <LogsafeRuntimeProvider value={runtime}>
    <Detail session={session} sessionId="s1" api={runtime.api} pluginFetch={pluginFetch} urlState={{ params, setParams }} tokens={TOKENS} />
  </LogsafeRuntimeProvider>,
)
```

Stub `pluginFetch` (a `vi.fn`) to control what your routes "return", and
assert on the DOM plus `setParams` calls for `urlState` interactions.

**Contract conformance** — cheaper, no rendering — checks your manifest
`type` matches what `resolveViewOwner` actually resolves for a session
carrying it. From `ui/src/test/starterTemplate.test.tsx`:

```tsx
it('compiles against the SDK and resolves for its type', () => {
  expect(starterUi.type).toBe('my-plugin')
  expect(typeof starterServer.matchType).toBe('function')
  const reg = buildRegistry([starterUi])
  expect(resolveViewOwner(session(['my-plugin']), reg)).toBe(starterUi)
})
```

## 6. Rules & gotchas

- **Write only `plugin_<id>_*` tables.** `ctx.db.table(name)` is a naming
  seam, not a sandbox — SQLite has no per-plugin schema isolation in one
  file, so always go through it rather than hardcoding a table name.
- **Matchers only run for still-`"generic"` events.** An explicit `type` on
  the ingest payload always wins; once any plugin's matcher claims an
  event, later matchers aren't tried.
- **`afterInsert` runs on the ingest hot path**, inside the request that
  wrote the batch. Keep it fast; defer heavier/unbounded work to your own
  routes computed on read.
- **`apiVersion` is a major-version gate.** A manifest `apiVersion` whose
  major doesn't match the SDK's `PLUGIN_API_VERSION` is skipped at load
  with a logged reason, not a crash.
- **The UI registry is build-time, not runtime.** `npm run plugins:sync`
  writes `ui/src/plugins.generated.ts`; changing `logsafe.config.json`
  needs a re-sync **and** `npm run build:ui` before it takes effect —
  restarting the server alone only reloads the *server*-side plugin list.
- **Duplicate plugin ids are skipped**; only the first-listed config entry
  for a given `id` loads.
- **`ownedTypes` gates `transform` and `afterInsert`, not just routing.** A
  plugin only gets `transform` called, and only receives events in
  `afterInsert`, for types it actually lists in `ownedTypes` — claiming a
  type via `matchType` without adding it there means those hooks never see
  it.
