# logsafe — Rename, npm Publish, AI Integration: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Written for execution by a FRESH session (Opus 4.8) with zero prior context.** Everything you need is in this file, the spec, and the repo. Read the "Repo State at Plan Time" section before Task 1. Recommended: run the controller on Opus, dispatch implementer subagents on Sonnet, reviewers on Sonnet.

**Goal:** Rename deblog → logsafe everywhere, make it publishable on npm as `logsafe` + `logsafe-client`, push the repo public to GitHub (`omarqx/logsafe`), and add AI-agent integration (a `logsafe mcp` stdio subcommand + a debugging skill).

**Architecture:** Three ordered workstreams (A rename → B packaging/GitHub → C MCP+skill) on an existing, working monorepo. The HTTP API is FROZEN (`API.md`) — nothing in this plan changes a route, param, or response shape. The MCP server is a thin HTTP client of the running logsafe server, never touching SQLite directly.

**Tech Stack:** TypeScript strict ESM, Fastify 5, better-sqlite3, Vite+React (ui), vitest, `@modelcontextprotocol/sdk` + `zod` (new, Task 8 only).

**Spec (authoritative):** `docs/superpowers/specs/2026-07-14-logsafe-rename-publish-ai-design.md`

## Repo State at Plan Time (read me first)

- Checkout: `~/sandbox/deblog` (Task 1 moves it to `~/Github/logsafe` — every later task works there). Branch `main`, clean tree. Branches `phase-2-backend`, `phase-4-ui` exist (history; leave them).
- Monorepo: root `package.json` (private, name `deblog`, workspaces `packages/*` + `ui`, scripts `start|demo|test|typecheck|dev:ui|build:ui`), `packages/server` (`@deblog/server`, private — Fastify app; src: `db.ts`, `normalize.ts`, `ingest.ts`, `queries.ts`, `sse.ts`, `app.ts`, `retention.ts`, `spa.ts`, `index.ts`), `packages/client` (`@deblog/client`, zero-dep logging helper, `src/index.ts`), `ui/` (Vite+React SPA, builds into `packages/server/public/`, which is gitignored), `examples/demo.ts`, `API.md` (frozen contract), `README.md`.
- 209 tests across 25 files, all green: `npm test`. Typecheck: `npm run typecheck` (3 tsc projects). Dev server: `npm start` (tsx). UI build: `npm run build:ui`.
- Server entrypoint `packages/server/src/index.ts`: top-level script — env parsing (`envNumber` helper; `PORT`=4600, `DEBLOG_DB`=`~/.deblog/deblog.db`, `RETENTION_DAYS`=7), `openDb`, `buildApp({db})`, conditional `registerSpa(app, publicDir)`, `safePrune()` at start + hourly unref'd interval, `app.listen({host:'127.0.0.1'})`.
- Client public API (`packages/client/src/index.ts`): `initDeblog(opts)`, `createLog(ns)`, `flush()`, `_resetForTests()`, `generateSessionId()`. It emits a synthetic drop-report warn with `ns: 'deblog'` and a single `console.warn('[deblog] …')` on outage. Tests assert both strings.
- Machine data: `~/.deblog/deblog.db` holds real sessions (a `demo: checkout flow` reference session + a 100k `scale-100k` session). Do not destroy — Task 4 migrates it.
- Machine config: `~/.claude/launch.json` has three entries pointing at `/Users/omarqaddoumi/sandbox/deblog` (names `deblog-design-mockups`, `deblog-server`, `deblog-ui`). Assistant memory file `/Users/omarqaddoumi/.claude/projects/-Users-omarqaddoumi/memory/deblog-project.md` describes the project.
- Process convention: `.superpowers/sdd/` is gitignored scratch for task briefs/reports/ledger. `git config user.*` is already set.

## Global Constraints

- **NEVER add `Co-Authored-By` trailers to commits** — explicit user requirement; the history was rewritten to purge them. Plain commit messages only.
- `API.md` is FROZEN: no route/param/response-shape changes. Only prose/name references in it change (with a version note, Task 3).
- Name: **logsafe** everywhere (npm `logsafe` + `logsafe-client`, bin `logsafe`, DB `~/.logsafe/logsafe.db`, env `LOGSAFE_DB`, client API `initLogsafe`, UI branding). No deblog back-compat aliases.
- Historical docs are exempt from the rename: `docs/superpowers/*` and `design/*` keep their deblog references (they're records). Everything else must grep clean (Task 2 gate).
- TypeScript strict, ESM (`"type": "module"`) throughout; Node >= 20 (`engines`).
- MCP tools are read-only — no delete/write tools. The MCP process talks HTTP only.
- GitHub: public repo `omarqx/logsafe` (gh CLI is authed as `omarqx`; name verified free 2026-07-14). Push `main` only. Secret-scan gate before first push.
- npm: both packages `version 0.1.0`, `license MIT`, `publishConfig.access public`. **Actual `npm publish` is Task 11 and requires an explicit user go-ahead — STOP and ask before publishing.**
- Commit after every task. Run commands from the repo root.

## File Structure (net new / heavily modified)

```
packages/server/
  src/cli.ts            NEW  bin entrypoint: serve (default) | mcp | --help | --version
  src/serve.ts          NEW  = current index.ts body wrapped in exported serve()
  src/index.ts          DELETED (replaced by serve.ts; root start script repointed)
  src/mcp.ts            NEW  stdio MCP server (Task 8)
  tsconfig.build.json   NEW  emitting build → dist/
  test/mcp.test.ts      NEW  real stdio MCP integration test
packages/client/
  (package.json/exports/dist wiring only — src API renamed in Task 2)
packages/server/skills/debugging-with-logsafe/SKILL.md   NEW  (Task 9; inside the server package so npm `files` packs it)
LICENSE                 NEW  (MIT, root; copied into both packages)
RELEASING.md            NEW  (Task 10)
```

---

### Task 1: Move the checkout to ~/Github/logsafe + repoint machine config

**Files:** none in-repo; moves the repo directory, edits `~/.claude/launch.json` and `/Users/omarqaddoumi/.claude/projects/-Users-omarqaddoumi/memory/deblog-project.md`.

**Interfaces:** Produces: the repo at `/Users/omarqaddoumi/Github/logsafe` — ALL later tasks run there.

- [ ] **Step 1: Move**

```bash
mv /Users/omarqaddoumi/sandbox/deblog /Users/omarqaddoumi/Github/logsafe
cd /Users/omarqaddoumi/Github/logsafe && git status --short && npm test 2>&1 | grep "Tests"
```
Expected: clean tree, `Tests  209 passed (209)` (path move breaks nothing; node_modules moved with it).

- [ ] **Step 2: Repoint `~/.claude/launch.json`**

Read it first. Replace every `/Users/omarqaddoumi/sandbox/deblog` with `/Users/omarqaddoumi/Github/logsafe`, and rename the three entry names `deblog-design-mockups` → `logsafe-design-mockups`, `deblog-server` → `logsafe-server`, `deblog-ui` → `logsafe-ui`. Do not touch the unrelated `saaleek-web` entry.

- [ ] **Step 3: Update the assistant memory file**

In `/Users/omarqaddoumi/.claude/projects/-Users-omarqaddoumi/memory/deblog-project.md`: rename the file to `logsafe-project.md`, update `name:` to `logsafe-project`, and rewrite path (`~/Github/logsafe`), names (logsafe, `logsafe-client`, `initLogsafe`, `LOGSAFE_DB`, `~/.logsafe/logsafe.db`) throughout. Update the corresponding index line in `/Users/omarqaddoumi/.claude/projects/-Users-omarqaddoumi/memory/MEMORY.md`.

- [ ] **Step 4: No commit** (nothing in-repo changed). Note completion in the ledger.

### Task 2: Rename sweep — code, tests, UI (not docs)

**Files:** Modify: root `package.json`, `packages/server/package.json`, `packages/client/package.json`, `packages/server/src/index.ts`, `packages/client/src/index.ts`, `packages/client/test/client.test.ts`, `examples/demo.ts`, `ui/index.html`, plus every ui/src file containing the string `deblog` (grep for it).

**Interfaces:** Produces: package names `logsafe` (server; keep `"private": true` until Task 5), `logsafe-client` (client; keep private until Task 6), root name `logsafe-workspace`; client export `initLogsafe` (same signature as old `initDeblog`); env var `LOGSAFE_DB`; default DB path `~/.logsafe/logsafe.db`.

- [ ] **Step 1: Write the failing test edits first (TDD on the observable renames)**

In `packages/client/test/client.test.ts`: change the import to `initLogsafe`, the drop-report assertion to expect `ns === 'logsafe'`, and the console.warn assertion (if it checks the prefix) to `[logsafe]`. Run `npx vitest run packages/client/test/client.test.ts` — FAILS (no such export).

- [ ] **Step 2: Rename the code**

- `packages/client/src/index.ts`: `initDeblog` → `initLogsafe`; synthetic warn `ns: 'deblog'` → `'logsafe'`; `console.warn('[deblog]…')` → `'[logsafe]…'`; doc comments.
- `packages/server/src/index.ts`: `DEBLOG_DB` → `LOGSAFE_DB`; `path.join(os.homedir(), '.deblog', 'deblog.db')` → `('.logsafe', 'logsafe.db')`; every `[deblog]` log prefix → `[logsafe]`.
- `examples/demo.ts`: import/call `initLogsafe`; any `deblog` strings in output text → logsafe.
- package.json files: names per Interfaces above (leave all other fields).
- `ui/index.html` `<title>` → `logsafe`; ui/src: logo text, footer `deblog v0.1.0` → `logsafe v0.1.0`, any other hits from `grep -rn deblog ui/src ui/index.html`.

- [ ] **Step 3: Grep gate + full suite**

```bash
git grep -il deblog -- ':!docs' ':!design' ':!.superpowers'
```
Expected: EMPTY output. Then `npm test` (209 pass) and `npm run typecheck` (clean).

- [ ] **Step 4: Visual smoke** — `npm run build:ui && DEBLOG_DB= LOGSAFE_DB=/tmp/ls-rename.db npm start &`, curl `/api/health`, curl `/` and confirm the served HTML title is logsafe; kill; `rm -f /tmp/ls-rename.db*`.

- [ ] **Step 5: Commit** — `git commit -m "rename: deblog -> logsafe across code, tests, ui"`

### Task 3: Docs rename (API.md version note, README)

**Files:** Modify: `API.md`, `README.md`.

- [ ] **Step 1: API.md** — replace deblog → logsafe in prose, examples, and header. In the freeze header add: `2026-07-14: project renamed deblog → logsafe. Routes, params, and shapes unchanged; only names in prose.` Env var references become `LOGSAFE_DB`.
- [ ] **Step 2: README.md** — full rename (title, prose, env table `LOGSAFE_DB`, client snippets `initLogsafe` + package `logsafe-client`, agent section curl examples unchanged except names). Top of README: add a one-liner under the title: ```Run it: `npx logsafe` → http://127.0.0.1:4600``` (true once published; the from-source `npm start` quickstart stays).
- [ ] **Step 3: Verify** — `git grep -il deblog -- ':!docs' ':!design' ':!.superpowers'` still empty; spot-check 3 curl examples against a scratch server (`LOGSAFE_DB=/tmp/ls-doc.db npm start`, curl, kill, rm).
- [ ] **Step 4: Commit** — `git commit -m "docs: rename to logsafe, API.md version note"`

### Task 4: Machine data migration

**Files:** none in-repo (machine state).

- [ ] **Step 1:**
```bash
mv ~/.deblog ~/.logsafe
mv ~/.logsafe/deblog.db ~/.logsafe/logsafe.db
[ -f ~/.logsafe/deblog.db-wal ] && mv ~/.logsafe/deblog.db-wal ~/.logsafe/logsafe.db-wal
[ -f ~/.logsafe/deblog.db-shm ] && mv ~/.logsafe/deblog.db-shm ~/.logsafe/logsafe.db-shm
```
- [ ] **Step 2: Verify** — `npm start &`, `curl -s localhost:4600/api/sessions | head -c 300` → shows the pre-existing sessions (`demo: checkout flow` label present); kill the server. This proves the default path now finds the migrated DB.
- [ ] **Step 3:** Ledger note; no commit.

### Task 5: Server build pipeline + CLI

**Files:** Create: `packages/server/tsconfig.build.json`, `packages/server/src/cli.ts`, `packages/server/src/serve.ts`, `LICENSE` (root + copy `packages/server/LICENSE`). Delete: `packages/server/src/index.ts`. Modify: `packages/server/package.json`, root `package.json` (start script).

**Interfaces:** Produces: `serve(): Promise<void>` in serve.ts; bin `logsafe` → `dist/cli.js`; `logsafe mcp` routes to `runMcp(url?: string)` from `./mcp.js` (Task 8 creates it — until then the dynamic import fails; acceptable mid-plan, do NOT stub it). Root `npm start` = `tsx packages/server/src/cli.ts`.

- [ ] **Step 1: serve.ts** — move the ENTIRE body of the current `src/index.ts` into:

```ts
// serve.ts — the `logsafe` server process. Extracted from the old index.ts
// so the CLI can route subcommands; behavior is identical.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { openDb } from './db.js'
import { buildApp } from './app.js'
import { pruneSessions } from './retention.js'
import { registerSpa } from './spa.js'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    console.warn(`[logsafe] invalid ${name}="${raw}", using default ${fallback}`)
    return fallback
  }
  return n
}

export async function serve(): Promise<void> {
  const PORT = envNumber('PORT', 4600)
  const DB_PATH = process.env.LOGSAFE_DB ?? path.join(os.homedir(), '.logsafe', 'logsafe.db')
  const RETENTION_DAYS = envNumber('RETENTION_DAYS', 7)

  const db = openDb(DB_PATH)
  const app = buildApp({ db })

  const publicDir = path.join(import.meta.dirname, '..', 'public')
  if (fs.existsSync(publicDir)) registerSpa(app, publicDir)

  function safePrune(): void {
    try {
      const pruned = pruneSessions(db, RETENTION_DAYS, Date.now())
      if (pruned > 0) console.log(`[logsafe] retention: pruned ${pruned} session(s) older than ${RETENTION_DAYS}d`)
    } catch (err) {
      console.error('[logsafe] retention prune failed (will retry next interval):', (err as Error).message)
    }
  }
  safePrune()
  setInterval(safePrune, 3_600_000).unref()

  const address = await app.listen({ host: '127.0.0.1', port: PORT })
  console.log(`[logsafe] listening on ${address}  (db: ${DB_PATH}, retention: ${RETENTION_DAYS}d)`)
}
```

**IMPORTANT:** the current `index.ts` is the source of truth — port ITS exact logic (the static/registerSpa guard, exact log lines post-Task-2 rename). If the block above disagrees with the current file beyond the wrapper function, keep the current file's behavior. One real change: `import.meta.dirname` resolves relative to `dist/` after compilation — `dist/../public` = `packages/server/public` ✓ (same relative shape as `src/../public`).

- [ ] **Step 2: cli.ts**

```ts
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
```

Delete `src/index.ts`. Root package.json: `"start": "tsx packages/server/src/cli.ts"`.

- [ ] **Step 3: tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "declaration": false },
  "include": ["src"]
}
```

- [ ] **Step 4: package.json (server)** — remove `"private": true`; add:

```json
  "version": "0.1.0",
  "description": "Local debugging log server: apps POST structured events over HTTP; sessions persist in SQLite with a dense web UI, SSE live tail, and an MCP server for AI agents.",
  "keywords": ["logging", "debugging", "local", "sqlite", "log-viewer", "mcp"],
  "license": "MIT",
  "bin": { "logsafe": "dist/cli.js" },
  "files": ["dist", "public", "skills", "LICENSE"],
  "engines": { "node": ">=20" },
  "repository": { "type": "git", "url": "git+https://github.com/omarqx/logsafe.git" },
  "bugs": "https://github.com/omarqx/logsafe/issues",
  "homepage": "https://github.com/omarqx/logsafe#readme",
  "publishConfig": { "access": "public" },
  "scripts": { "build": "tsc -p tsconfig.build.json", "prepublishOnly": "npm --prefix ../.. run build:ui && tsc -p tsconfig.build.json && npx vitest run --root ../.." }
```

Create `LICENSE` at repo root (standard MIT text, `Copyright (c) 2026 Omar Qaddoumi`) and copy it to `packages/server/LICENSE`.

- [ ] **Step 5: Verify** — `npm test` (209 — the old index.ts had no direct tests; if any test imported it, repoint to serve.ts), `npm run typecheck`, then compiled-mode smoke:

```bash
npm run build -w packages/server && npm run build:ui
LOGSAFE_DB=/tmp/ls-cli.db node packages/server/dist/cli.js &
sleep 1; curl -s localhost:4600/api/health   # {"ok":true}
node packages/server/dist/cli.js --version   # 0.1.0
node packages/server/dist/cli.js --help | head -2
kill %1; rm -f /tmp/ls-cli.db*
```
(`logsafe mcp` will fail until Task 8 — expected, don't test it here.)

- [ ] **Step 6: Commit** — `git commit -m "feat: compiled CLI entrypoint, publishable server package metadata"`

### Task 6: Client package publishability

**Files:** Modify: `packages/client/package.json`, `packages/client/tsconfig.json` (only if needed). Create: `packages/client/LICENSE` (copy of root).

- [ ] **Step 1: package.json (client)** — remove `private` if present; set:

```json
  "name": "logsafe-client",
  "version": "0.1.0",
  "description": "Zero-dependency logging client for logsafe: batched HTTP delivery, sendBeacon unload flush, never throws into the host app.",
  "keywords": ["logging", "logsafe", "debugging"],
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "sideEffects": false,
  "files": ["dist", "LICENSE"],
  "engines": { "node": ">=20" },
  "repository": { "type": "git", "url": "git+https://github.com/omarqx/logsafe.git", "directory": "packages/client" },
  "publishConfig": { "access": "public" },
  "scripts": { "build": "tsc -p tsconfig.json", "prepublishOnly": "tsc -p tsconfig.json && npx vitest run --root ../.. src" }
```

Note: `examples/demo.ts` and the client tests import `../src/index.js` RELATIVELY, so switching `exports` to dist breaks nothing in-repo. Verify that claim with `git grep -n "logsafe-client\|@deblog/client" -- ':!docs'` (expect no source imports by package name; fix any stragglers to relative or workspace-correct form).

- [ ] **Step 2: Verify** — `npm run build -w packages/client` emits `dist/index.js` + `dist/index.d.ts`; `npm test`; `npm run typecheck`.
- [ ] **Step 3: Commit** — `git commit -m "feat: publishable logsafe-client package (dist + exports map)"`

### Task 7: Public GitHub repo

**Files:** none (remote + push).

- [ ] **Step 1: Secret scan the FULL history** (gate — do not push if any hit looks real):

```bash
git log --all -p | grep -nEi "api[_-]?key|secret|passwd|password\s*[:=]|BEGIN (RSA|EC|OPENSSH) PRIVATE|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[bap]-" | grep -vE "password.*(example|test|fake)" | head -40
```
Review every hit in context (test fixtures and prose are fine). Known-accepted: machine paths/username in `docs/superpowers/*`. Also confirm no trailers remain: `git log --all --format='%B' | grep -ci co-authored` → 0.

- [ ] **Step 2: Create + push**

```bash
gh repo create omarqx/logsafe --public --description "Local debugging log server: structured logs over HTTP, SQLite sessions, dense web UI, SSE live tail, MCP for AI agents" --source . --remote origin --push
```
(This pushes the current branch, `main`, only — matching the spec.)

- [ ] **Step 3: Verify** — `gh repo view omarqx/logsafe --web` optional; at minimum `gh api repos/omarqx/logsafe --jq '.visibility, .default_branch'` → `public`, `main`, and `curl -s https://raw.githubusercontent.com/omarqx/logsafe/main/README.md | head -3` shows the logsafe README.
- [ ] **Step 4:** Ledger note; no commit.

### Task 8: `logsafe mcp` — stdio MCP server (TDD)

**Files:** Create: `packages/server/src/mcp.ts`, `packages/server/test/mcp.test.ts`. Modify: `packages/server/package.json` (deps).

**Interfaces:** Consumes: the frozen HTTP API only. Produces: `runMcp(urlArg?: string): Promise<void>` (cli.ts already routes to it). Tools: `list_sessions`, `get_session`, `query_events`, `tail_session`.

- [ ] **Step 1: Install deps** — `npm install -w packages/server @modelcontextprotocol/sdk zod`

- [ ] **Step 2: Write the failing integration test** — `packages/server/test/mcp.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { openDb } from '../src/db.js'
import { buildApp } from '../src/app.js'

const SERVER_DIR = path.resolve(import.meta.dirname, '..')

let app: FastifyInstance
let base: string
let client: Client

beforeAll(async () => {
  app = buildApp({ db: openDb(':memory:') })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const addr = app.server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  base = `http://127.0.0.1:${addr.port}`

  await fetch(`${base}/v1/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([
      { session_id: 's1', session_label: 'mcp test', source: 'api', ns: 'auth:token', level: 'error', msg: 'boom' },
      { session_id: 's1', source: 'api', ns: 'http', level: 'info', msg: 'ok' },
    ]),
  })

  client = new Client({ name: 'test', version: '0.0.0' })
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/cli.ts', 'mcp', '--url', base],
    cwd: SERVER_DIR,
  })
  await client.connect(transport)
}, 30_000)

afterAll(async () => {
  await client?.close()
  await app?.close()
})

describe('logsafe mcp', () => {
  it('exposes exactly the four read-only tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual(['get_session', 'list_sessions', 'query_events', 'tail_session'])
  })

  it('list_sessions returns the fixture session', async () => {
    const res = await client.callTool({ name: 'list_sessions', arguments: {} })
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('mcp test')
    expect(text).toContain('"error_count": 1')
  })

  it('query_events applies filters', async () => {
    const res = await client.callTool({
      name: 'query_events',
      arguments: { session_id: 's1', level: 'error' },
    })
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('boom')
    expect(text).not.toContain('"msg": "ok"')
  })

  it('tail_session returns new events within the timeout', async () => {
    const call = client.callTool({
      name: 'tail_session',
      arguments: { session_id: 's1', after_seq: 2, timeout_s: 8 },
    })
    await new Promise((r) => setTimeout(r, 1200))
    await fetch(`${base}/v1/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', source: 'api', ns: 'live', msg: 'tailed!' }),
    })
    const res = await call
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text).toContain('tailed!')
  }, 15_000)

  it('unknown session surfaces the API 404 clearly', async () => {
    const res = await client.callTool({ name: 'get_session', arguments: { session_id: 'nope' } })
    expect(res.isError).toBe(true)
    const text = (res.content as { type: string; text: string }[])[0].text
    expect(text.toLowerCase()).toContain('not found')
  })
})

describe('logsafe mcp with no server', () => {
  it('tools return a friendly start-the-server error', async () => {
    const lone = new Client({ name: 'test2', version: '0.0.0' })
    const t = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/cli.ts', 'mcp', '--url', 'http://127.0.0.1:1'],
      cwd: SERVER_DIR,
    })
    await lone.connect(t)
    const res = await lone.callTool({ name: 'list_sessions', arguments: {} })
    expect(res.isError).toBe(true)
    expect((res.content as { type: string; text: string }[])[0].text).toContain('npx logsafe')
    await lone.close()
  }, 30_000)
})
```

Run: `npx vitest run packages/server/test/mcp.test.ts` — FAILS (cannot find `./mcp.js`).

- [ ] **Step 3: Implement `packages/server/src/mcp.ts`**

```ts
// logsafe mcp — stdio MCP server for AI agents (Cursor, Claude Code, any
// MCP client). A thin, READ-ONLY HTTP client of a running logsafe server:
// it never opens the SQLite db; the frozen HTTP contract (API.md) stays
// the single API.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRequire } from 'node:module'
import { z } from 'zod'

const DEFAULT_URL = 'http://127.0.0.1:4600'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}
function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export async function runMcp(urlArg?: string): Promise<void> {
  const base = (urlArg ?? process.env.LOGSAFE_URL ?? DEFAULT_URL).replace(/\/+$/, '')

  async function api(path: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    let res: Response
    try {
      res = await fetch(`${base}${path}`)
    } catch {
      return { ok: false, error: `logsafe server not reachable at ${base} — start it with \`npx logsafe\`` }
    }
    if (res.status === 404) return { ok: false, error: 'not found: unknown session id' }
    if (!res.ok) return { ok: false, error: `logsafe server responded ${res.status}` }
    return { ok: true, data: await res.json() }
  }

  const pkg = createRequire(import.meta.url)('../package.json') as { version: string }
  const server = new McpServer({ name: 'logsafe', version: pkg.version })

  server.tool(
    'list_sessions',
    'List logsafe debug sessions, newest first. Fields per session: id, label (human hint), sources, event_count, error_count, warn_count, status ("active" = received events in the last 60s), first_ts/last_ts/duration_ms.',
    {},
    async () => {
      const r = await api('/api/sessions')
      return r.ok ? ok(r.data) : fail(r.error)
    },
  )

  server.tool(
    'get_session',
    'Get one session summary by id.',
    { session_id: z.string() },
    async ({ session_id }) => {
      const r = await api(`/api/sessions/${encodeURIComponent(session_id)}`)
      return r.ok ? ok(r.data) : fail(r.error)
    },
  )

  const queryShape = {
    session_id: z.string(),
    ns: z.string().optional().describe('namespace filter, comma-OR, * wildcard: "auth:*,player.*"'),
    level: z.string().optional().describe('comma-OR levels: "warn,error"'),
    source: z.string().optional().describe('comma-OR sources: "webapp,api"'),
    trace: z.string().optional().describe('exact trace id — follows one request across sources'),
    q: z.string().optional().describe('case-insensitive text search over msg and ctx'),
    from_ts: z.number().optional().describe('epoch ms lower bound on ts'),
    to_ts: z.number().optional().describe('epoch ms upper bound on ts'),
    after_seq: z.number().optional().describe('pagination cursor: events with seq > this'),
    limit: z.number().optional().describe('default 500, max 10000'),
  }

  function toParams(args: Record<string, unknown>): string {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(args)) {
      if (k === 'session_id' || v === undefined) continue
      sp.set(k, String(v))
    }
    const s = sp.toString()
    return s === '' ? '' : `?${s}`
  }

  server.tool(
    'query_events',
    'Query a session\'s events. All filters AND together. Results are ordered by seq ASC (server arrival order — trust seq, not ts, for ordering); returns { events, next_after_seq } — pass next_after_seq back as after_seq to page. Read narrow-first: level="error", then trace=, then widen.',
    queryShape,
    async (args) => {
      const r = await api(`/api/sessions/${encodeURIComponent(args.session_id)}/events${toParams(args)}`)
      return r.ok ? ok(r.data) : fail(r.error)
    },
  )

  server.tool(
    'tail_session',
    'Wait (bounded) for NEW events in a session — use while reproducing a bug. Polls until something arrives after after_seq or timeout_s (default 10, max 30) elapses; returns { events, next_after_seq } (possibly empty on timeout — not an error). If after_seq is omitted, tails from the current end of the session.',
    {
      session_id: z.string(),
      after_seq: z.number().optional(),
      timeout_s: z.number().optional(),
    },
    async ({ session_id, after_seq, timeout_s }) => {
      const timeoutMs = Math.min(Math.max(1, timeout_s ?? 10), 30) * 1000
      let cursor = after_seq
      if (cursor === undefined) {
        // Default to "now": find the session's current tip via its last_ts.
        const s = await api(`/api/sessions/${encodeURIComponent(session_id)}`)
        if (!s.ok) return fail(s.error)
        const lastTs = (s.data as { last_ts: number }).last_ts
        const probe = await api(`/api/sessions/${encodeURIComponent(session_id)}/events?from_ts=${lastTs}&limit=1`)
        if (!probe.ok) return fail(probe.error)
        const first = (probe.data as { events: { seq: number }[] }).events[0]
        cursor = first === undefined ? 0 : first.seq
      }
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const r = await api(`/api/sessions/${encodeURIComponent(session_id)}/events?after_seq=${cursor}&limit=1000`)
        if (!r.ok) return fail(r.error)
        const page = r.data as { events: unknown[]; next_after_seq: number | null }
        if (page.events.length > 0) return ok(page)
        if (Date.now() >= deadline) return ok({ events: [], next_after_seq: cursor })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    },
  )

  await server.connect(new StdioServerTransport())
}
```

**Note on SDK compatibility:** the plan targets `@modelcontextprotocol/sdk` v1.x. If `server.tool(name, description, shape, handler)` has been renamed in the installed version (e.g. to `registerTool`), adapt to the installed SDK's equivalent — the tool names, descriptions, shapes, and handlers above are the contract; the registration call is not.

- [ ] **Step 4: Run to green** — `npx vitest run packages/server/test/mcp.test.ts` (6 tests). Then `npm test`, `npm run typecheck`. Also verify compiled mode: `npm run build -w packages/server && echo '{}' | node packages/server/dist/cli.js mcp --url http://127.0.0.1:1` starts without crashing (Ctrl-C/kill after a beat — stdio server waits for input; a clean start with no stack trace is the check).
- [ ] **Step 5: Commit** — `git commit -m "feat: logsafe mcp — stdio MCP server with read-only session tools"`

### Task 9: Debugging skill + README AI section

**Files:** Create: `packages/server/skills/debugging-with-logsafe/SKILL.md` (inside the server package so npm `files: ["skills", …]` packs it). Modify: `README.md` (new "AI agents: MCP + skill" subsection extending the existing "For AI coding agents" section).

- [ ] **Step 1: SKILL.md** — create with this content (adjust only if factually wrong vs the repo):

```markdown
---
name: debugging-with-logsafe
description: Use when debugging a running application whose behavior you can reproduce — instrument the app with logsafe structured logging, reproduce the bug, and read the session narrow-first (errors → trace → widen). Works via logsafe MCP tools when connected, or plain HTTP/curl.
---

# Debugging with logsafe

logsafe is a local log server (default `http://127.0.0.1:4600`). Apps POST
structured events; you read them back as filterable sessions. Ordering is
always server arrival order (`seq`) — never trust client `ts` for ordering.

## Workflow

1. **Check the server.** MCP: call `list_sessions`. HTTP:
   `curl -s localhost:4600/api/health` → `{"ok":true}`. If down, start it:
   `npx logsafe` (background it; it binds 127.0.0.1 only).
2. **Instrument the app under debug.** Always set a fresh, descriptive
   `session_label` per attempt so the session is findable.
   - JS/TS: `npm i logsafe-client`, then
     `initLogsafe({ source: 'api', sessionLabel: 'bug-1234 attempt 1' })`
     and `createLog('payment')` → `log.debug/info/warn/error(msg, ctx)`.
     Use `createLog(ns).withTrace(id)` to follow one request across
     processes — give the SAME trace id to frontend and backend.
   - Anything else: POST JSON to `/v1/log` — only `msg` is required:
     `curl -s localhost:4600/v1/log -d '{"session_id":"bug-1234","source":"api","ns":"payment","level":"error","msg":"...","ctx":{...}}'`
3. **Reproduce the bug** with the instrumented app.
4. **Read narrow-first.**
   - MCP: `query_events(session_id, level: "error")`, then
     `query_events(session_id, trace: "<id>")`, then widen
     (`level: "warn,error"`, `ns: "payment.*"`, `q: "timeout"`).
   - HTTP: same params on `GET /api/sessions/<id>/events`.
   - Bulk analysis: `GET /api/sessions/<id>/export.ndjson` (one JSON per line).
5. **Live-tail while re-reproducing** to watch cause → effect in order.
   - MCP: `tail_session(session_id)` right before triggering the bug —
     it waits (≤30s) and returns what arrived.
   - HTTP: `curl -N localhost:4600/api/sessions/<id>/stream`.
6. **Clean up** instrumentation when fixed: grep the app for the `ns`
   values you added.

## Reading results

- Sessions list is newest-first; `status: "active"` = events in the last 60s.
- `error_count`/`warn_count` on the session tell you where to look first.
- `next_after_seq` is the pagination cursor — pass it back as `after_seq`.
- `ctx` is arbitrary JSON the app attached; `received_at` vs `ts` exposes
  client clock skew.
```

- [ ] **Step 2: README section** — under the existing "For AI coding agents" section, add setup for both surfaces:

````markdown
### Hooking up an AI agent

**MCP (Cursor, Claude Code, any MCP client)** — logsafe ships an MCP server:

```jsonc
// Cursor: ~/.cursor/mcp.json
{ "mcpServers": { "logsafe": { "command": "npx", "args": ["logsafe", "mcp"] } } }
```

```bash
# Claude Code:
claude mcp add logsafe -- npx logsafe mcp
```

Tools: `list_sessions`, `get_session`, `query_events`, `tail_session` —
read-only, talking to your local server (override with `--url` or `LOGSAFE_URL`).

**Skill (Claude Code)** — a debugging workflow skill ships in this repo/package:

```bash
cp -r skills/debugging-with-logsafe ~/.claude/skills/
```

(For Cursor, paste the SKILL.md body into a project rule instead.)
````

- [ ] **Step 3: Verify** — `npm test` unaffected; `npm pack -w packages/server --dry-run 2>&1 | grep SKILL` lists `skills/debugging-with-logsafe/SKILL.md` (the dir is package-relative under `packages/server/`, matching Task 5's `files` array). README copy commands: `cp -r node_modules/logsafe/skills/debugging-with-logsafe ~/.claude/skills/` for installed users, `cp -r packages/server/skills/debugging-with-logsafe ~/.claude/skills/` for from-source users.
- [ ] **Step 4: Commit** — `git commit -m "feat: debugging-with-logsafe skill + agent setup docs"`

### Task 10: RELEASING.md + pack-and-install smoke + push

**Files:** Create: `RELEASING.md`.

- [ ] **Step 1: RELEASING.md**

````markdown
# Releasing logsafe

Two independent packages: `logsafe` (packages/server) and `logsafe-client`
(packages/client). Versions bump independently.

1. Bump `version` in the package(s) you're releasing.
2. Full gate: `npm test && npm run typecheck && npm run build:ui`.
3. Pack-and-install smoke (must pass before any publish):

```bash
npm run build:ui
npm pack -w packages/server -w packages/client --pack-destination /tmp
mkdir -p /tmp/ls-smoke && cd /tmp/ls-smoke && npm init -y >/dev/null
npm i /tmp/logsafe-*.tgz /tmp/logsafe-client-*.tgz
LOGSAFE_DB=/tmp/ls-smoke.db npx logsafe &          # serves
sleep 1
curl -s localhost:4600/api/health                   # {"ok":true}
curl -s localhost:4600/ | grep -qi logsafe && echo UI-OK
node -e "import('logsafe-client').then(m => console.log(typeof m.initLogsafe))"  # function
npx logsafe --version
kill %1; cd /; rm -rf /tmp/ls-smoke /tmp/ls-smoke.db* /tmp/logsafe-*.tgz
```

4. MCP handshake check: configure a scratch MCP client (or
   `npx tsx packages/server/test/mcp.test.ts` equivalent — the integration
   test in CI-less form is `npx vitest run packages/server/test/mcp.test.ts`).
5. Publish (needs `npm login`): `npm publish -w packages/client` then
   `npm publish -w packages/server`.
6. Tag: `git tag logsafe-vX.Y.Z && git push origin --tags`.
````

- [ ] **Step 2: Run the smoke from RELEASING.md end to end** (steps 2–4; skip publish). Every line must behave as commented. `prepublishOnly` runs during `npm pack`? No — pack runs `prepack`, publish runs `prepublishOnly`; ensure `npm pack` still contains fresh `dist/` by running builds first (the doc's step 3 does).
- [ ] **Step 3: Push** — `git push origin main`, verify `gh api repos/omarqx/logsafe/commits --jq '.[0].commit.message'` matches the latest commit.
- [ ] **Step 4: Commit** (RELEASING.md itself) — `git commit -m "docs: release process"` then push again.

### Task 11: npm publish — GATED

- [ ] **Step 1: STOP.** Ask the user explicitly: "Ready to publish logsafe 0.1.0 and logsafe-client 0.1.0 to npm? Requires `npm login` as an account you control." **Do not proceed without a yes in this session.**
- [ ] **Step 2 (on yes):** `npm whoami` (if not logged in, have the user run `npm login`); then `npm publish -w packages/client && npm publish -w packages/server`; verify `npm view logsafe version` → `0.1.0`, `npm view logsafe-client version` → `0.1.0`; smoke `npx logsafe@0.1.0 --version` from a temp dir.
- [ ] **Step 3:** Tag + push per RELEASING.md. Update README top if the npx line was hedged.

## Exit criteria

1. `npm test` green, `npm run typecheck` clean, from `~/Github/logsafe`.
2. `git grep -il deblog -- ':!docs' ':!design' ':!.superpowers'` → empty.
3. Compiled CLI works without tsx: serve + `--version` + `mcp` handshake (vitest mcp suite green).
4. Pack-and-install smoke (RELEASING.md step 3) passes.
5. `omarqx/logsafe` public, `main` pushed, secret-scan logged in the ledger, README renders on the landing page.
6. Old data reachable: server on default path lists the pre-rename sessions.
7. Publish done ONLY if the user said yes at Task 11.
