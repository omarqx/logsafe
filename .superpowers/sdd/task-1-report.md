# Task 1 report: UI scaffold + theme + shell

## What was built

- `ui/package.json` — new `@deblog/ui` workspace. Deps: `react` `19.2.0`,
  `react-dom` `19.2.0`, `react-router-dom` `7.18.1`, `@tanstack/react-virtual`
  `3.14.6`, `@fontsource/jetbrains-mono` `5.2.8`. Dev deps: `vite` `8.1.4`,
  `@vitejs/plugin-react` `6.0.3`, `typescript`/`@types/react`/`@types/react-dom`,
  `@testing-library/react` `16.3.2`, `jsdom` `29.1.1`. Scripts: `dev` → `vite`,
  `build` → `vite build`.
- `ui/tsconfig.json` — extends `../tsconfig.base.json`, overrides
  `lib: [ES2022, DOM, DOM.Iterable]`, `jsx: react-jsx`, `module: ESNext`,
  `moduleResolution: bundler`, `types: [vite/client]`, `noEmit: true`.
- `ui/vite.config.ts` — matches the brief's essentials exactly: dev server on
  port 5173 with `/api` and `/v1` proxied to `127.0.0.1:4600`; build outDir
  resolved to `../packages/server/public` with `emptyOutDir: true`.
- `ui/index.html` — title `deblog`, `#root` div, `<script type="module"
  src="/src/main.tsx">`.
- `ui/src/main.tsx` — `BrowserRouter` + `Routes` for `/` (`SessionListPage`)
  and `/s/:id` (`SessionDetailPage`), wrapped in a `Shell` component,
  `StrictMode`.
- `ui/src/Shell.tsx` — the `.frame` shell with the Phosphor `header`
  containing the `deblog` logo + blinking `.cursor` span, matching the
  mockups' markup.
- `ui/src/routes/SessionListPage.tsx`, `ui/src/routes/SessionDetailPage.tsx`
  — placeholder route components (detail page echoes the `:id` param).
- `ui/src/theme.css` — every `Global Constraints` token as CSS custom
  properties, verbatim from `design/direction-a-*.html`: `--bg #0a0d0b`,
  `--bg-raise #0e1210`, `--txt #b6c2b8`, `--dim #5d6b60`, `--faint #37423a`,
  `--line #1a221c`, `--phos #4af0a8`, `--amber #ffb454`, `--err #ff5c53`,
  `--cyan #5cc9f5`, `--violet #c792ea` (plus `--slate #8fa3b8` from the
  session-list mockup, used for the `worker` source tag), and `--mono`. Added
  `--row-h: 20px` for later virtualized-list/log-stream row height (matches
  the mockups' `.logrow` box height: 16px line-height + 2px+2px padding).
  Ported the mockups' base rules: html/body background+color+font,
  `body::after` scanline overlay, `.frame`, `header`/`.logo`/`.cursor`
  (+ `blink`/`pulse` keyframes), `.crumb`, `.cmdline`, `.chip`/`.chip.on`/
  `.chip.on-err`, `kbd`, and `footer` — these are shared across both mockup
  screens so later tasks (list/detail routes) can reuse them without
  redefining. Font is bundled via `@fontsource/jetbrains-mono` weight/style
  CSS imports (400, 400-italic, 500, 700) — no Google Fonts `@import`, so the
  app works offline.
- Root `package.json` — added `"ui"` to `workspaces`; added `dev:ui` (`npm
  run dev --workspace=ui`) and `build:ui` (`npm run build --workspace=ui`)
  scripts; extended `typecheck` to `tsc -p packages/server && tsc -p
  packages/client --noEmit && tsc -p ui --noEmit`.
- `.gitignore` — added `packages/server/public/` (the UI build output that
  the server serves as static files).

## Verification

1. **`npm install` from root** — succeeded, no errors, 0 vulnerabilities.
2. **`npm run build:ui`** — succeeded in 314ms; emitted
   `packages/server/public/index.html`, `packages/server/public/assets/*.js`,
   `*.css`, and the bundled JetBrains Mono `.woff2`/`.woff` files (Latin +
   extended subsets), confirming the font is bundled rather than
   network-fetched.
3. **`npm run typecheck`** — clean across `packages/server`,
   `packages/client`, and `ui` (no output = no errors).
4. **`npm test`** — 8 test files, 58 tests, all passing (server + client
   suites unaffected; no UI tests added in this task).
5. **Boot check without the browser** — started `npm run dev:ui` in the
   background and curled it. Port 5173 was already occupied by an unrelated
   dev server belonging to a different project on this machine (confirmed via
   `lsof`; the process serving 5173 returned `<html lang="ar" dir="rtl">`,
   clearly not deblog). Vite's normal "port in use, trying another one"
   fallback bound our server to **5174** instead. `curl -s localhost:5174`
   returned the expected Vite-injected HTML: `<title>deblog</title>`,
   `<div id="root">`, `<script type="module" src="/src/main.tsx">`. This
   confirms the scaffold boots correctly; the port collision is an
   environment artifact, not a scaffold defect (`ui/vite.config.ts` correctly
   requests port 5173 per the brief). The dev server process was killed
   afterward.

## Files changed

- `ui/package.json` (new)
- `ui/tsconfig.json` (new)
- `ui/vite.config.ts` (new)
- `ui/index.html` (new)
- `ui/src/main.tsx` (new)
- `ui/src/Shell.tsx` (new)
- `ui/src/theme.css` (new)
- `ui/src/routes/SessionListPage.tsx` (new)
- `ui/src/routes/SessionDetailPage.tsx` (new)
- `package.json` (modified: workspaces, scripts)
- `package-lock.json` (modified: new workspace deps)
- `.gitignore` (modified: ignore `packages/server/public/`)

## Concerns

- Port 5173 was occupied by another project's dev server during my
  verification session (environmental, unrelated to this repo). Anyone
  running `npm run dev:ui` while that other server is up will land on 5174+
  instead; nothing to fix in this repo, just worth knowing if a later
  verification step hardcodes port 5173.
- `--slate` (`#8fa3b8`) is defined in `theme.css` even though the brief's
  token list didn't call it out explicitly — it's used by the `worker`
  source tag in `direction-a-session-list.html`, and later tasks building
  the session-list route will need it. Flagging in case this should instead
  be added when that route is implemented.
- Only the shared/base CSS classes (`.frame`, `header`, `.cmdline`, `.chip`,
  `kbd`, `footer`, keyframes) were ported into `theme.css` in this task,
  since Task 1's scope is the shell, not the list/detail screens. Route-
  specific classes (`.cols`, `.row`, `.logrow`, `.minimap`, `.pinned`, `.src`
  variants, etc.) are left for the tasks that build those routes — noting
  this so the next task doesn't assume they're already ported.
