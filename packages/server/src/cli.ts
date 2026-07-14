#!/usr/bin/env node
// logsafe CLI: `logsafe` serves; `logsafe mcp` runs the stdio MCP server.
import { createRequire } from 'node:module'

const HELP = `logsafe — local debugging log server

Usage:
  logsafe                start the server (http://127.0.0.1:4600)
  logsafe mcp [--url U]  MCP server (stdio) for AI agents; U = logsafe base
                         URL (default http://127.0.0.1:4600 or $LOGSAFE_URL)
  logsafe --version      print version
  logsafe --help         this text

Env: PORT, LOGSAFE_DB, RETENTION_DAYS — see README.`

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv
  switch (cmd) {
    case undefined:
      await (await import('./serve.js')).serve()
      break
    case 'mcp': {
      const i = rest.indexOf('--url')
      const url = i !== -1 ? rest[i + 1] : undefined
      await (await import('./mcp.js')).runMcp(url)
      break
    }
    case '--version':
    case '-v': {
      const pkg = createRequire(import.meta.url)('../package.json') as { version: string }
      console.log(pkg.version)
      break
    }
    case '--help':
    case '-h':
      console.log(HELP)
      break
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`)
      process.exit(1)
  }
}
void main()
