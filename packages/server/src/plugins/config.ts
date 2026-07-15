import fs from 'node:fs'
import path from 'node:path'

/** Reads the `plugins` string[] from logsafe.config.json (or $LOGSAFE_CONFIG).
    Absent or malformed → [] (with a warning), never throws. */
export function readPluginConfig(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const file = env.LOGSAFE_CONFIG ?? path.join(cwd, 'logsafe.config.json')
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { plugins?: unknown }
    if (!Array.isArray(parsed.plugins)) return []
    return parsed.plugins.filter((p): p is string => typeof p === 'string')
  } catch (err) {
    console.warn(`[logsafe] failed to read ${file}: ${(err as Error).message}`)
    return []
  }
}
