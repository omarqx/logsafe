# Task 1 Report: Extract `createMcpServer(base)` from `runMcp`

## What moved

`packages/server/src/mcp.ts`: everything from the `api()` fetch helper through
the four `server.tool(...)` registrations (list_sessions, get_session,
query_events, tail_session) moved verbatim out of `runMcp` into a new
exported `createMcpServer(base: string): McpServer`. No line inside that
block was altered — same closures over `base`, same `api()` implementation
(loopback-tolerant error messages unchanged), same tool descriptions, arg
shapes (zod schemas), and fetch paths.

`runMcp(urlArg?)` now only: resolves `base` (unchanged line —
`urlArg ?? process.env.LOGSAFE_URL ?? DEFAULT_URL`, trailing slash stripped),
calls `const server = createMcpServer(base)`, then
`await server.connect(new StdioServerTransport())`.

Module-level `ok`/`fail`/`ToolResult` were already module-level and are
untouched.

## Diff shape

```diff
--- a/packages/server/src/mcp.ts
+++ b/packages/server/src/mcp.ts
@@ -18,9 +18,7 @@ function fail(message: string): ToolResult {
   return { content: [{ type: 'text', text: message }], isError: true }
 }
 
-export async function runMcp(urlArg?: string): Promise<void> {
-  const base = (urlArg ?? process.env.LOGSAFE_URL ?? DEFAULT_URL).replace(/\/+$/, '')
-
+export function createMcpServer(base: string): McpServer {
   async function api(path: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
     let res: Response
     try {
@@ -122,5 +120,11 @@ export async function runMcp(urlArg?: string): Promise<void> {
     },
   )
 
+  return server
+}
+
+export async function runMcp(urlArg?: string): Promise<void> {
+  const base = (urlArg ?? process.env.LOGSAFE_URL ?? DEFAULT_URL).replace(/\/+$/, '')
+  const server = createMcpServer(base)
   await server.connect(new StdioServerTransport())
 }
```

1 file changed, 7 insertions(+), 3 deletions(-). No other files touched;
`cli.ts` (the only other consumer of `runMcp`) is unaffected since the
public signature of `runMcp` didn't change.

## Test evidence

- `npx vitest run packages/server/test/mcp.test.ts` — 1 test file, 6/6 tests
  passed (unmodified file).
- `npm run typecheck` — clean (`tsc -p packages/server && tsc -p
  packages/client --noEmit && tsc -p ui --noEmit`), no errors.

## Self-review

- Confirmed byte-for-byte identity of the moved block (only whitespace/brace
  restructuring at the extraction boundary; tool descriptions, arg shapes,
  and fetch paths untouched).
- Confirmed `createMcpServer` is exported and matches the brief's signature
  `(base: string): McpServer`.
- Confirmed `ok`/`fail`/`ToolResult` remain module-level (were already, no
  change needed).
- Confirmed no other source file references the internals being moved (only
  `cli.ts` imports `runMcp`, whose external behavior/signature is
  unchanged).
- Grep-checked for any other importer of `mcp.ts` exports — none besides
  `cli.ts` and the existing test.

## Commit

`745f214` — `refactor(mcp): extract createMcpServer factory for reuse across transports`
(no Co-Authored-By trailer, on branch `demo-serves-ui`).

## Concerns

None. The refactor is mechanical and behavior-preserving; regression gate
(6 tests) and typecheck are both green.
