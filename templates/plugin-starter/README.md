# logsafe plugin starter

Five steps to your own plugin:

1. **Copy** this directory somewhere (e.g. `cp -r templates/plugin-starter ../my-plugin`).
2. **Rename** the id: replace every `my-plugin` in `package.json` (both the
   package name and the `logsafe` manifest) and in `server.ts` / `ui.tsx`.
3. **Edit the matcher** in `server.ts` so `matchType` claims your events
   (by `ns`, `source`, or anything on the event). Ingest can also set an
   explicit `type` field, which wins over matchers.
4. **Enable it**: add the path or package name to `logsafe.config.json`:
   `{ "plugins": ["../my-plugin"] }`
5. **Build + restart**: `npm run build:ui` then restart the server. The
   server logs `loaded 1 plugin(s): <id>` on startup.

Recipes (custom visuals, live tail, your own API routes): `docs/PLUGINS.md`.
Full worked example: `examples/plugin-http`.
