import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readPluginConfig } from '../src/plugins/config.js'

describe('plugin config', () => {
  it('returns [] when no config is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsafe-'))
    expect(readPluginConfig(dir, {})).toEqual([])
  })

  it('reads the plugins array from logsafe.config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsafe-'))
    fs.writeFileSync(path.join(dir, 'logsafe.config.json'), JSON.stringify({ plugins: ['a', './b'] }))
    expect(readPluginConfig(dir, {})).toEqual(['a', './b'])
  })
})
