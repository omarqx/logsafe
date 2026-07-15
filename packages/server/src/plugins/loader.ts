import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Db } from '../db.js'
import type { ServerPlugin, PluginManifest, ServerPluginContext } from '@coglet/logsafe-plugin-sdk/server'
import { PLUGIN_API_VERSION } from '@coglet/logsafe-plugin-sdk/server'
import { makePluginContext } from './context.js'

export interface LoadedServerPlugin {
  manifest: PluginManifest
  plugin: ServerPlugin
  ctx: ServerPluginContext
}

function major(v: string): string { return v.split('.')[0] }

/** Resolve a module specifier's package.json relative to `resolveDir`. */
function resolvePackageJson(specifier: string, resolveDir: string): { dir: string; pkg: Record<string, unknown> } {
  const req = createRequire(pathToFileURL(path.join(resolveDir, 'noop.js')))
  const pkgPath = req.resolve(`${specifier}/package.json`)
  const pkg = req(`${specifier}/package.json`) as Record<string, unknown>
  return { dir: path.dirname(pkgPath), pkg }
}

export async function loadServerPlugins(
  db: Db,
  specifiers: string[],
  resolveDir: string,
  opts: { apiVersion?: string } = {},
): Promise<LoadedServerPlugin[]> {
  const accept = opts.apiVersion ?? PLUGIN_API_VERSION
  const loaded: (LoadedServerPlugin & { _order: number })[] = []

  for (let i = 0; i < specifiers.length; i++) {
    const specifier = specifiers[i]
    let dir: string, pkg: Record<string, unknown>
    try {
      ({ dir, pkg } = resolvePackageJson(specifier, resolveDir))
    } catch {
      console.warn(`[logsafe] plugin "${specifier}" not resolvable; skipping`)
      continue
    }
    const manifest = pkg.logsafe as PluginManifest | undefined
    if (!manifest?.id || !manifest.apiVersion) {
      console.warn(`[logsafe] plugin "${specifier}" has no valid "logsafe" manifest (missing id or apiVersion); skipping`)
      continue
    }
    if (major(manifest.apiVersion) !== major(accept)) {
      console.warn(`[logsafe] plugin "${manifest.id}" targets apiVersion ${manifest.apiVersion}, core is ${accept}; skipping`)
      continue
    }
    if (!manifest.server) continue // ui-only plugin: nothing to load server-side

    try {
      const entryUrl = pathToFileURL(path.resolve(dir, manifest.server)).href
      const mod = (await import(entryUrl)) as { default?: ServerPlugin }
      const plugin = mod.default
      if (!plugin) {
        console.warn(`[logsafe] plugin "${manifest.id}" server entry has no default export; skipping`)
        continue
      }
      const ctx = makePluginContext(db, manifest.id)
      plugin.migrate?.(ctx)
      await plugin.setup?.(ctx)
      loaded.push({ manifest, plugin, ctx, _order: i })
    } catch (err) {
      console.warn(`[logsafe] plugin "${manifest.id}" failed to load: ${(err as Error).message}; skipping`)
      continue
    }
  }

  loaded.sort((a, b) => (b.manifest.priority ?? 0) - (a.manifest.priority ?? 0) || a._order - b._order)
  return loaded.map(({ _order, ...rest }) => rest)
}
