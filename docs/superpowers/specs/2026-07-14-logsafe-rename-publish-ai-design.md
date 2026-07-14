# logsafe — Rename, npm Publishing, AI Integration: Design Spec

**Date:** 2026-07-14
**Status:** Approved (brainstorm decisions locked with user)

## 1. Purpose

Three ordered workstreams on the existing deblog codebase (`~/sandbox/deblog`):

- **A. Rename** the app from deblog to **logsafe** — everywhere, no aliases.
- **B. Make it publishable on npm** as two packages: `logsafe` (server + UI,
  npx-runnable) and `logsafe-client` (zero-dependency helper).
- **C. AI integration** so agents (Cursor, Claude Code) can debug apps with
  it: a `logsafe mcp` stdio subcommand plus a debugging-workflow skill.

Decisions already made with the user: name `logsafe` (bare `petra` and
`deblog` are taken on npm; `logsafe` is free — verified 2026-07-14); two
packages, not one; MCP + skill, not either alone.

### Out of scope

- Back-compat aliases for deblog names (nothing is deployed anywhere).
- CI / automated releases (manual `npm publish`); branch protection.
- Any change to HTTP routes, params, or response shapes — `API.md` stays
  frozen; only prose/branding in it changes (with a version note).
- Destructive MCP tools (no delete_session tool).

## 2. Workstream A — Rename deblog → logsafe

Hard rename, one sweep:

| Surface | From → To |
|---|---|
| Server package name | `@deblog/server` → `logsafe` |
| Client package name | `@deblog/client` → `logsafe-client` |
| Command / bin | `npm start` stays; published bin is `logsafe` |
| Default DB path | `~/.deblog/deblog.db` → `~/.logsafe/logsafe.db` |
| Env var | `DEBLOG_DB` → `LOGSAFE_DB` (`PORT`, `RETENTION_DAYS` unchanged) |
| Client init API | `initDeblog()` → `initLogsafe()` |
| Client synthetic-warn ns | `"deblog"` → `"logsafe"` |
| Client console.warn prefix | `[deblog]` → `[logsafe]` |
| UI logo, `<title>`, footer version string | deblog → logsafe |
| Docs | API.md + README renamed in prose; API.md freeze header gets a version note recording the rename |
| Repo-local | root package name, demo script labels, test strings that assert on names |

Machine migration (this machine only, done during implementation, documented
in README): `mv ~/.deblog ~/.logsafe && mv ~/.logsafe/deblog.db ~/.logsafe/logsafe.db`
(plus `-wal`/`-shm` if present). **The checkout moves to `~/Github/logsafe`**
(`mv ~/sandbox/deblog ~/Github/logsafe`) — production projects live in
`~/Github` per the user's convention; nothing in-code depends on the path,
but the machine-local references do and are updated in the same step:
`~/.claude/launch.json` (three entries point at the old path) and the
assistant memory file.

Verification: full existing suite passes after the sweep (name-only change);
a repo-wide case-insensitive grep for `deblog` returns only the historical
docs (`docs/superpowers/*`, `design/*` mockups) — those are records, not
product surface, and stay as-is.

## 3. Workstream B — npm publishing

### 3.1 `logsafe` (packages/server)

- **Compiled, not tsx:** `tsc` emits `dist/` (ESM, `.js` + `.d.ts` not
  required for the server; JS only is fine). tsconfig gains an emitting
  build config; `noEmit` stays for typecheck.
- **Entrypoint refactor:** current `src/index.ts` (top-level await script)
  becomes `main(argv)` in `src/cli.ts` with a `#!/usr/bin/env node` banner;
  zero-dependency arg parsing:
  - `logsafe` (no args) → serve (current behavior exactly)
  - `logsafe mcp [--url http://127.0.0.1:4600]` → Workstream C
  - `logsafe --help` / `--version`
- **package.json:** `name: logsafe`, `version: 0.1.0`, `bin: { logsafe: "dist/cli.js" }`,
  `files: ["dist", "public"]`, `engines: { node: ">=20" }`, `license: MIT`
  (LICENSE file added at repo root), description + keywords,
  `publishConfig: { access: public }`. `prepublishOnly`: build UI into
  `public/` + tsc build + run tests.
- **Deps unchanged** (fastify, @fastify/cors, @fastify/static,
  better-sqlite3 — prebuilt binaries cover mac/linux/win) plus
  `@modelcontextprotocol/sdk` for Workstream C.
- The dev loop (`npm start` via tsx, `npm run dev:ui`) is untouched.

### 3.2 `logsafe-client` (packages/client)

- tsc emits `dist/index.js` + `dist/index.d.ts`; `exports` map with `types`
  + `import` conditions; `main`/`types` fields for older tooling;
  `sideEffects: false`; zero runtime dependencies (unchanged); same
  metadata/license treatment. `files: ["dist"]`.
- The `ui/` workspace and demo import the built package via the workspace
  (imports keep working; update specifiers from `@deblog/client`).

### 3.3 Public GitHub repo

- Create **public** repo `omarqx/logsafe` (gh CLI is authed as `omarqx`;
  name verified free 2026-07-14) and push `main` (full history, including
  the deblog-era commits — honest provenance).
- **Pre-push hygiene gate:** scan the full history for secrets/tokens
  (`git log -p` grep for key patterns) before the first push. Known and
  accepted: docs contain local machine paths and the process artifacts in
  `docs/superpowers/*` — paths and a username are not secrets. The
  `.superpowers/` scratch dir and `packages/server/public/` build output
  are already gitignored and never committed.
- Both package.json files gain `repository`, `bugs`, and `homepage`
  pointing at the repo (this supersedes the earlier "add later" note).
- README top: one-line install/run (`npx logsafe`) so the repo landing
  page is usable.

### 3.4 Release flow

- `RELEASING.md` at repo root: version bump per package, `npm publish -w packages/client`
  then `-w packages/server`, and the pre-publish smoke:
  `npm pack` each package → install tarballs into a temp dir → `npx logsafe`
  serves, `curl /api/health` OK, `node -e "require/import logsafe-client"`
  resolves, `logsafe mcp` handshakes.
- Versions are independent; both start at 0.1.0. No CI.

## 4. Workstream C — AI integration

### 4.1 `logsafe mcp` (stdio MCP server)

- Lives in the `logsafe` package (`src/mcp.ts`), started by the CLI. Uses
  `@modelcontextprotocol/sdk` over stdio. It is a thin HTTP client of a
  running logsafe server: base URL from `--url` or `LOGSAFE_URL`, default
  `http://127.0.0.1:4600`. It does NOT open the SQLite db itself — the HTTP
  contract remains the single API.
- **Tools (read-only, thin wrappers over API.md):**
  - `list_sessions()` → session summaries (newest first)
  - `get_session(session_id)` → one summary or not-found
  - `query_events(session_id, filters?)` — filters: `ns`, `level`, `source`,
    `trace`, `q`, `from_ts`, `to_ts`, `after_seq`, `limit` (same semantics
    as the HTTP params, documented in each tool's description); returns
    `{ events, next_after_seq }`
  - `tail_session(session_id, after_seq?, timeout_s?)` — waits up to
    `timeout_s` (default 10, max 30) for events with seq > after_seq, then
    returns whatever arrived (possibly empty) plus the new cursor. Bounded:
    an MCP tool call must terminate. Implementation may poll
    `/events?after_seq=` internally (1s interval) — simpler and more robust
    over stdio than holding SSE.
  - No delete/write tools.
- **Errors:** server unreachable → tool result (not protocol error) with
  actionable text: "logsafe server not running — start it with `npx logsafe`".
  Unknown session → the API's 404 surfaced clearly.
- **Tool descriptions carry the agent guidance:** newest-first, narrow-first
  (`level=error` → `trace=`), seq is the order/cursor, ts is client-clock.
- **Config snippets documented in README:** Cursor `~/.cursor/mcp.json` and
  `claude mcp add logsafe -- npx logsafe mcp`.

### 4.2 Debugging skill

- `skills/debugging-with-logsafe/SKILL.md` in the repo, shipped in the
  `logsafe` npm package (`files` += `skills`), installable by copying into
  `~/.claude/skills/` (README shows the one-liner; also usable nearly
  verbatim as a Cursor rule — README shows that too).
- Frontmatter description targets triggering: use when debugging a running
  app whose behavior you can reproduce — instrument, reproduce, read logs.
- Content (workflow the tools can't teach):
  1. Check the server: `GET /api/health` (or `list_sessions` via MCP); if
     down, `npx logsafe` (background it).
  2. Instrument the app under debug: `logsafe-client` snippet
     (`initLogsafe({ source, sessionLabel })`) for JS/TS, curl one-liner
     for anything else. Always set a fresh, descriptive `session_label`
     per attempt.
  3. Reproduce the bug.
  4. Read narrow-first: `level=error`, then `trace=` to follow one request
     across sources, then widen (`level=warn,error`, `ns=` wildcards, `q=`).
     Prefer `export.ndjson` for bulk analysis.
  5. Live-tail (`tail_session` / SSE) while re-reproducing to watch cause →
     effect ordering. Trust `seq` for ordering, never `ts`.
  6. Clean up instrumentation when the bug is fixed (grep for the ns you
     added).
- The skill references MCP tool names when connected, with curl fallbacks.

## 5. Error handling summary

| Failure | Behavior |
|---|---|
| MCP started, server down | Friendly tool-result error naming `npx logsafe` |
| `tail_session` sees nothing | Returns empty batch + unchanged cursor at timeout (not an error) |
| Bad tool args | MCP input-schema validation rejects before HTTP |
| `npm pack` smoke fails | Release blocked (documented as a RELEASING.md gate) |

## 6. Testing

- **A:** full existing suite (209 tests) green post-rename; grep gate for
  stray `deblog` outside historical docs.
- **B:** build outputs verified (dist runs under plain `node`, no tsx);
  pack-and-install smoke in a temp dir per RELEASING.md; client tarball
  imports cleanly with types; history secret-scan passes before the GitHub
  push; pushed repo landing page renders README correctly.
- **C:** integration test spawning `logsafe mcp` as a child process,
  speaking real MCP over stdio (initialize → list tools → call
  `list_sessions`/`query_events`/`tail_session`) against a temp-DB server;
  unreachable-server test asserts the friendly error. Skill verified by a
  walkthrough during final review (instrument a toy script → reproduce →
  read via MCP).

## 7. Delivery

One implementation plan, workstreams in order A → B → C (A is a prerequisite
for both others; C's subcommand rides B's CLI). Single user review gate at
the end (plus normal per-task review loops).
