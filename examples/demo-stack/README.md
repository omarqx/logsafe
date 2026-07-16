# logsafe demo-stack

## What this is

A one-command Docker Compose stack that shows off logsafe's plugin system
end to end. It builds a logsafe image with both example plugins
(`plugin-http` and `plugin-jobs`) baked in, and runs three small generator
services — an API gateway, a job worker, and a web app — that stream
realistic, continuous traffic into it via `POST /v1/log`. Open the UI and
watch three different session views (http timeline, job stat cards, and a
generic flat view) fill in live, side by side.

## Run it

```bash
cd examples/demo-stack
docker compose up --build
```

The first build runs `npm ci` and a full UI build inside the `logsafe`
image, so it takes a few minutes. Once it's up, open
[http://localhost:4600](http://localhost:4600).

## The tour

1. **Session list** — three renderers at once: the ⚡ http badge row
   (`api-gateway`), the ⚙ jobs badge row (`job-worker`), and a default
   generic row (`webapp`).
2. Open `api-gateway` — a request **timeline**. Click a red (5xx) bar to
   filter down to that trace; the paired generic log line emitted from the
   same request shows up too, demonstrating cross-source trace filtering.
3. Open `job-worker` — **stat cards + a sparkline**, with job failures
   plotted as red dots.
4. Open `webapp` — the plain flat view: level filters, a periodic error
   burst visible as texture on the minimap, and (first within ~5s, then every ~20s) a
   **"metrics plugin not installed"** banner on the one event type
   (`metrics`) no installed plugin owns.
5. Everything live-tails — the generators never stop, so all three views
   keep updating for as long as the stack is up.

## How it works

The compose file (`docker-compose.yml`) runs four services:

- `logsafe` — built from `Dockerfile.logsafe` with the **repo root** as
  build context, so it can `COPY . .` the whole monorepo, drop in
  `examples/demo-stack/logsafe.config.json`, and run `npm run build:ui`
  (which runs `plugins:sync` first — this is what bakes both example
  plugins into the UI bundle at image-build time). Exposes `4600` on
  `127.0.0.1` only, and persists `/data` (the sqlite db) in a named volume.
- `gateway` — built from `generators/Dockerfile.generator` with
  `SCRIPT=gateway.mjs`; posts `http`-typed request events plus a paired
  generic log per request under the `api-gateway` session.
- `worker` — same generator image with `SCRIPT=worker.mjs`; posts
  `job:*`-typed lifecycle events (start → done/failed) under the
  `job-worker` session.
- `webapp` — same generator image with `SCRIPT=webapp.mjs`; posts generic
  logs across a few namespaces and levels, plus an occasional
  `type: "metrics"` event that no installed plugin owns, under the
  `webapp` session.

All three generators wait on `logsafe`'s healthcheck (`/api/health`) before
starting, and drop the batch and continue if a POST fails, so `docker compose up` always
comes up clean regardless of build order.

## Cleanup

```bash
docker compose down
```

Add `-v` to also drop the named volume and reset the demo data:

```bash
docker compose down -v
```
