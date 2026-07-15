import type { UIPlugin, SessionSummary } from '@coglet/logsafe-plugin-sdk/ui'

/** Registry preserves insertion order; the generated array is already ordered
 *  by manifest priority (see scripts/plugins-sync.mjs), so first match wins. */
export function buildRegistry(plugins: UIPlugin[]): Map<string, UIPlugin> {
  const map = new Map<string, UIPlugin>()
  for (const p of plugins) if (!map.has(p.type)) map.set(p.type, p)
  return map
}

/** Highest-priority installed plugin whose type ∈ session.types; else undefined. */
export function resolveViewOwner(session: SessionSummary, registry: Map<string, UIPlugin>): UIPlugin | undefined {
  for (const [type, plugin] of registry) {
    if (session.types.includes(type)) return plugin
  }
  return undefined
}
