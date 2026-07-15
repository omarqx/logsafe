import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.join(import.meta.dirname, '..', '..', '..')
const pluginsSyncScript = path.join(repoRoot, 'scripts', 'plugins-sync.mjs')

describe('plugins-sync codegen', () => {
  it('emits an empty registry when config lists no plugins', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsync-'))
    fs.writeFileSync(path.join(dir, 'logsafe.config.json'), JSON.stringify({ plugins: [] }))
    const out = path.join(dir, 'plugins.generated.ts')
    execFileSync('node', [pluginsSyncScript], {
      env: { ...process.env, LOGSAFE_CONFIG: path.join(dir, 'logsafe.config.json'), LOGSAFE_UI_OUT: out },
    })
    const text = fs.readFileSync(out, 'utf8')
    expect(text).toContain('export const uiPlugins')
    expect(text).toContain('[]')
  })

  it('emits a real import + registry entry for a resolvable plugin package', () => {
    // The script resolves specifiers via createRequire from repo root, so an
    // absolute path to a real plugin package (examples/plugin-hello) resolves
    // directly — proving the codegen's non-empty, multi-plugin path works.
    const helloSpec = path.join(repoRoot, 'examples', 'plugin-hello')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsync-'))
    fs.writeFileSync(path.join(dir, 'logsafe.config.json'), JSON.stringify({ plugins: [helloSpec] }))
    const out = path.join(dir, 'plugins.generated.ts')
    execFileSync('node', [pluginsSyncScript], {
      env: { ...process.env, LOGSAFE_CONFIG: path.join(dir, 'logsafe.config.json'), LOGSAFE_UI_OUT: out },
    })
    const text = fs.readFileSync(out, 'utf8')
    const importLine = `import p0 from '${helloSpec}/ui'`
    expect(text).toContain(importLine)
    expect(text).toMatch(/export const uiPlugins: UIPlugin\[\] = \[p0\]/)
  })
})
