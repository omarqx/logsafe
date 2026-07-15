import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('plugins-sync codegen', () => {
  it('emits an empty registry when config lists no plugins', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsync-'))
    fs.writeFileSync(path.join(dir, 'logsafe.config.json'), JSON.stringify({ plugins: [] }))
    const out = path.join(dir, 'plugins.generated.ts')
    execFileSync('node', [path.join(import.meta.dirname, '..', '..', '..', 'scripts', 'plugins-sync.mjs')], {
      env: { ...process.env, LOGSAFE_CONFIG: path.join(dir, 'logsafe.config.json'), LOGSAFE_UI_OUT: out },
    })
    const text = fs.readFileSync(out, 'utf8')
    expect(text).toContain('export const uiPlugins')
    expect(text).toContain('[]')
  })
})
