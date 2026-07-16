# @coglet/logsafe-plugin-sdk

Types and runtime helpers for building [logsafe](https://github.com/omarqx/logsafe)
plugins — a plugin can enrich ingested events (matcher + transform), persist
its own tables, mount API routes, and render a custom list row / detail view
for the sessions it owns.

This is the contract surface plugin authors build against. It has no
dependency on the logsafe server itself — just the shared types and a few UI
runtime hooks.

## Install

```bash
npm i @coglet/logsafe-plugin-sdk
```

`react` is an optional peer dependency (only needed if your plugin ships a UI).

## Two entry points

**`@coglet/logsafe-plugin-sdk/server`** — server contract:

```ts
import type { ServerPlugin, IncomingEvent } from '@coglet/logsafe-plugin-sdk/server'

export const plugin: ServerPlugin = {
  matchType: (ev: IncomingEvent) => (ev.ns.startsWith('http:') ? 'http' : null),
  // transform?, afterInsert?, routes?, onSessionDelete? — all optional
}
```

**`@coglet/logsafe-plugin-sdk/ui`** — UI contract + runtime hooks
(`useCoreApi`, `usePluginFetch`, `useSessionEvents`, `useThemeTokens`,
`FlatLogView`):

```tsx
import type { UIPlugin, ListRowProps } from '@coglet/logsafe-plugin-sdk/ui'
import { useSessionEvents } from '@coglet/logsafe-plugin-sdk/ui'
```

A plugin declares itself via a `"logsafe"` manifest block in its own
`package.json` (`id`, `apiVersion`, `ownedTypes`, `server`/`ui` entry
modules). Core refuses a plugin whose `apiVersion` major differs from
`PLUGIN_API_VERSION`.

## Full guide

See [PLUGINS.md](https://github.com/omarqx/logsafe/blob/main/docs/PLUGINS.md)
for the complete authoring walkthrough, and `templates/plugin-starter` for a
copyable skeleton with a conformance test.
