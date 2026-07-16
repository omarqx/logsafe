# logsafe HTTP API

> **This contract is FROZEN as of Phase 2.** The web UI (Phase 3/4) is built
> strictly against this document. Changes require a version note here.
>
> - 2026-07-14: project renamed deblog → logsafe. Routes, params, and shapes
>   unchanged; only names in prose.
> - 2026-07-15: added DELETE /api/sessions/:id/events?through_seq= (purge).
>   Existing routes/shapes unchanged.

Base URL: `http://127.0.0.1:4600` (default; see `README.md#configuration`).
All responses are `application/json` unless noted otherwise. CORS is
permissive (any origin may call this API — it's a local debugging tool).

- [`POST /v1/log`](#post-v1log) — ingest one event or a batch
- [`GET /api/health`](#get-apihealth) — liveness check
- [`GET /api/sessions`](#get-apisessions) — list sessions
- [`GET /api/sessions/:id`](#get-apisessionsid) — one session's summary
- [`GET /api/sessions/:id/events`](#get-apisessionsidevents) — query events
- [`GET /api/sessions/:id/export.ndjson`](#get-apisessionsidexportndjson) — bulk export
- [`GET /api/sessions/:id/stream`](#get-apisessionsidstream) — live SSE tail
- [`DELETE /api/sessions/:id`](#delete-apisessionsid) — delete a session
- [`DELETE /api/sessions/:id/events`](#delete-apisessionsidevents) — purge events through a seq

---

## `POST /v1/log`

Ingest one event (a JSON object) or a batch (a JSON array of objects).

**Content-Type handling:** The server accepts **any** `Content-Type` header and
parses the body as JSON. This means bare `curl -d '...'` works without extra
headers (it sends `application/x-www-form-urlencoded`), and
`navigator.sendBeacon` works (it sends `text/plain`). The body must still be
valid JSON; invalid JSON returns `400`.

### Event fields

| Field | Type | Required | Default / coercion |
|---|---|---|---|
| `msg` | string | **yes** | Missing/`undefined` or `null` **rejects the event** outright. Any other value is coerced to a string if not already one — `JSON.stringify`'d, falling back to `String()`. `msg: 42` → `"42"`. `msg: {code:500}` → `"{\"code\":500}"`. If the (possibly coerced) result is the empty string `""`, the event is **rejected**. |
| `ts` | number (epoch ms) or ISO 8601 string | no | Finite number → truncated to an integer. String → `Date.parse`'d. Anything else, or an unparseable string, or `NaN` → falls back to server receive time. |
| `session_id` | string | no | Non-empty string is used as-is. Missing/empty/non-string → a scratch id `scratch-YYYY-MM-DD` (UTC day bucket, from server receive time) — same-day events with no `session_id` land in the same session. |
| `source` | string | no | Non-empty string used as-is; otherwise `"default"`. |
| `ns` | string | no | Used as-is if a string; otherwise `""`. |
| `level` | `"debug" \| "info" \| "warn" \| "error"` | no | Exact (case-sensitive) match against those four values is stored as-is. Anything else (including absent) falls back to `"info"`, **except**: if `level` was present but not one of the four, the *original* value is preserved under `ctx._level` (see below). Absent `level` does not touch `ctx`. |
| `ctx` | any JSON value, or omitted | no | Stored as JSON text, or `null`. Explicit `ctx: null` is stored and returned as `null` (not the string `"null"`, not dropped). See the level-coercion interaction below. |
| `trace` | string | no | Non-empty string used as-is; otherwise `null`. |
| `session_label` | string | no | Non-empty string used as-is; otherwise ignored (no default is written). See session-label semantics below. |

**Level-coercion / ctx interaction:** when `level` is present but invalid, the
original value is folded into `ctx` so it isn't lost, instead of being
silently discarded:
- `ctx` absent → `ctx` becomes `{"_level": <original level value>}`.
- `ctx` is a plain object → the original level is merged in as `ctx._level`
  (existing keys are kept).
- `ctx` is anything else (array, string, number, explicit `null`, …) → `ctx`
  becomes `{"_level": <original level value>, "value": <original ctx>}`.

Example: `{"msg":"x","level":"bogus"}` → stored `level: "info"`,
`ctx: {"_level":"bogus"}`.

**`session_label` semantics:** the label is a per-*session* property, not
per-event (it does not appear on `StoredEvent`). Any event in a request that
carries a non-empty `session_label` updates the session's stored label. If a
batch contains more than one, the **last** one in submission order wins for
that request. A session with no label ever sent has `label: null`.

### Request bodies

**Single object:**
```json
{ "msg": "checkout failed", "session_id": "s1", "level": "error" }
```
→ `202 Accepted` `{"accepted": 1, "rejected": 0}`, or `400` if the event is
invalid (see below).

**Batch (array):** invalid events inside a batch are silently dropped and
counted in `rejected` — **the batch itself never fails** because of bad
individual events.
```json
[{ "msg": "a" }, { "not msg": true }, { "msg": "b" }]
```
→ `202 Accepted` `{"accepted": 2, "rejected": 1}`.

### Status codes

| Code | When |
|---|---|
| `202` | Always for a well-formed batch (array), even if every event in it was rejected (`accepted: 0`). For a single object, when that one event was valid. |
| `400` | Single-object body that is not a salvageable event (not a JSON object, or missing/`null`/empty `msg`), **or** the request body is not valid JSON at all (any content type, malformed JSON → `400`). |
| `413` | Batch array longer than **1000** events (`{"error":"batch exceeds 1000 events"}`), or request body exceeds the **5 MB** body limit (Fastify's default payload-too-large response). |

### curl example

Bare curl (no headers needed):
```bash
curl -s localhost:4600/v1/log -d '{"msg":"hello world"}'
# {"accepted":1,"rejected":0}

curl -s localhost:4600/v1/log -d '[
  {"msg":"request start","session_id":"s1","source":"api","ns":"http","trace":"req-1"},
  {"msg":"request done","session_id":"s1","source":"api","ns":"http","trace":"req-1","level":"info"}
]'
# {"accepted":2,"rejected":0}
```

Or with an explicit content-type header (optional):
```bash
curl -s localhost:4600/v1/log -H 'content-type: application/json' -d '{"msg":"hello"}'
# {"accepted":1,"rejected":0}
```

---

## `GET /api/health`

Liveness check, no auth, no params.

```json
{ "ok": true }
```

---

## `GET /api/sessions?limit=&offset=`

Lists sessions, **newest first** (`ORDER BY last_ts DESC`).

| Query param | Type | Default | Clamped range |
|---|---|---|---|
| `limit` | integer | 50 | truncated to an integer, clamped to `[1, 1000]` |
| `offset` | integer | 0 | truncated to an integer, clamped to `>= 0` |

Non-numeric/empty values fall back to the default (not an error).

Response: `200` — a JSON array of **SessionSummary**:

| Field | Type | Notes |
|---|---|---|
| `id` | string | session id |
| `label` | string \| null | last non-empty `session_label` seen, or `null` |
| `first_ts` | number | min `ts` across the session's events (client clock) |
| `last_ts` | number | max `ts` across the session's events (client clock) |
| `duration_ms` | number | `last_ts - first_ts` |
| `status` | `"active" \| "idle"` | `"active"` iff `now - last_ts <= 60_000` (60s), evaluated at request time |
| `event_count` | number | total events in the session |
| `error_count` | number | events with `level: "error"` |
| `warn_count` | number | events with `level: "warn"` |
| `sources` | string[] | distinct `source` values seen, alphabetically sorted |

---

## `GET /api/sessions/:id`

Same **SessionSummary** shape as one element of the list above, for a single
session.

- `200` — the session.
- `404` — `{"error": "session not found"}` if no session with that id exists.

---

## `GET /api/sessions/:id/events`

Query events within one session. **Does not 404 for an unknown session id**
— it just returns an empty `events` array (there's no existence check;
querying a nonexistent session behaves like querying an empty one).

### Filters (query params)

All supplied filters are AND'd together. Within a single comma-separated
filter (`ns`, `level`, `source`), the values are OR'd.

| Param | Meaning |
|---|---|
| `ns` | Comma-separated list, OR'd. Each item is matched against `ns` using glob-style matching where **`*` is the only wildcard** (matches any run of characters, including empty). `?` and `[...]` are treated as literal characters, not wildcards (unlike raw SQLite GLOB). Example: `ns=auth:*` matches `auth:token`, `auth:login`, `auth:`; `ns=payment.*,cart:*` OR's two patterns. |
| `level` | Comma-separated list, OR'd, exact match against the stored level (`debug`/`info`/`warn`/`error`). `level=warn,error` matches either. |
| `source` | Comma-separated list, OR'd, exact match. |
| `trace` | Single value, exact match (no comma-splitting). |
| `q` | Case-insensitive substring match against `msg` **or** the raw `ctx` JSON text. |
| `from_ts` | `ts >= from_ts` (inclusive, client clock). |
| `to_ts` | `ts <= to_ts` (inclusive, client clock). |
| `after_seq` | `seq > after_seq` — pass the previous response's `next_after_seq` here to page forward. |
| `before_seq` | `seq < before_seq`. |
| `limit` | Truncated to an integer, clamped to `[1, 10000]`. Default **500**. |

Non-numeric/empty numeric params (`from_ts`, `to_ts`, `after_seq`,
`before_seq`, `limit`) are treated as absent, not errors.

### Response

`200`:
```json
{ "events": [ /* StoredEvent[] */ ], "next_after_seq": 123 }
```

- **Ordering: `seq ASC`, always.**
- `next_after_seq` is the `seq` of the last returned event **only when the
  page was full** (i.e. exactly `limit` rows came back — there may be more).
  It is `null` when fewer than `limit` rows were returned (no more pages).
  Pass it back as `after_seq` on the next request to page forward.

### StoredEvent fields

| Field | Type | Notes |
|---|---|---|
| `seq` | number | Monotonic, server-assigned, unique across the whole database (not per-session). This is the authoritative ordering key. Values are never reused, even after sessions are deleted (SQLite `AUTOINCREMENT`), so a held `after_seq` cursor can never silently skip new data. |
| `session_id` | string | |
| `ts` | number | Client-provided (or coerced) event time, epoch ms. Not trustworthy for ordering — use `seq`. |
| `received_at` | number | Server receive time, epoch ms, for the batch this event arrived in. |
| `source` | string | |
| `ns` | string | |
| `level` | `"debug" \| "info" \| "warn" \| "error"` | |
| `msg` | string | |
| `ctx` | any JSON value \| null | Parsed (not a JSON string) — an object, array, scalar, or `null`. |
| `trace` | string \| null | |

Note: `session_label` is **not** an event field — it only affects the
session summary (see `POST /v1/log` above).

---

## `GET /api/sessions/:id/export.ndjson`

Same filters and semantics as `GET /api/sessions/:id/events`, but streams
**every matching event** (internally paginated past the 10000 cap, in pages
of 5000) as newline-delimited JSON — one `StoredEvent` object per line, in
`seq ASC` order. Good for `jq`, `grep`, or bulk analysis.

- `200`, `Content-Type: application/x-ndjson; charset=utf-8`.
- No trailing envelope — just events, in order, one per line. An unknown
  session id or a filter matching nothing streams a `200` with an empty
  body (not a `404`).

```bash
curl -s 'localhost:4600/api/sessions/s1/export.ndjson' | jq -c 'select(.level=="error")'
```

---

## `GET /api/sessions/:id/stream?after_seq=N`

Server-Sent Events (SSE). Two phases, delivered seamlessly and losslessly
(no duplicate or dropped events even under slow-client backpressure):

1. **Replay** — every event with `seq > after_seq` (default `after_seq=0`,
   i.e. the whole session) is sent first, in `seq ASC` order, internally
   paginated the same way as `export.ndjson`.
2. **Live** — once replay catches up, newly-ingested events for this session
   are pushed as they arrive. Only events for the same `:id` are delivered.

- `200`, `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`.
- Event frame format:
  ```
  event: log
  data: <StoredEvent JSON>

  ```
  (one JSON object per `data:` line, frame terminated by a blank line).
- A heartbeat comment (`: hb\n\n`) is sent every **15 seconds** to keep the
  connection alive through proxies/load balancers. It is a comment line, not
  an `event:`/`data:` frame — SSE clients ignore it by spec.
- Resume: reconnect with `?after_seq=<last seq you saw>` to pick up where
  you left off without re-receiving already-seen events.
- Streaming a nonexistent session id is not an error — the connection opens
  normally, replay yields nothing, and it idles on heartbeats waiting for
  events that may never come.

```bash
curl -N 'localhost:4600/api/sessions/s1/stream?after_seq=0'
```

---

## `DELETE /api/sessions/:id`

Deletes the session and all of its events.

- `204` — deleted, empty body.
- `404` — `{"error": "session not found"}`, no events deleted.

---

## `DELETE /api/sessions/:id/events?through_seq=N`

Purges (hard-deletes) events, unlike the soft `after_seq` view-floor the UI
also offers — this permanently removes rows.

Deletes every event in the session with `seq <= through_seq`, then
recomputes the session's summary from the survivors, in one transaction.

- `through_seq` is **inclusive**. It's deliberately named `through_seq`, not
  `before_seq`, to avoid confusion with the query API's exclusive
  `before_seq` filter above — a destructive operation gets
  self-documenting, unambiguous naming. `through_seq=N` deletes exactly
  what a view floor of `after_seq=N` would hide.
- Recomputed fields (from the surviving events only): `event_count`,
  `error_count`, `warn_count`, `first_ts` (min `ts`), `last_ts` (max `ts`),
  `sources` (distinct, sorted). `label` is left unchanged.
- **If no events survive, the session row is deleted too** — a session
  with zero events isn't representable (`first_ts`/`last_ts` are `NOT
  NULL`), and this matches `DELETE /api/sessions/:id` semantics.
- `seq` is `AUTOINCREMENT` and never reused, so a purge can never cause an
  `after_seq` cursor (from `events`, `export.ndjson`, or `stream`) to
  replay the wrong events — only fewer of them.

| Query param | Type | Required |
|---|---|---|
| `through_seq` | number | **yes** |

### Response

| Code | Body |
|---|---|
| `200` | `{ "deleted": number, "session": SessionSummary \| null }` — `deleted` is the row count removed; `session` is the updated summary, or `null` if the session was fully purged and its row deleted. |
| `404` | `{"error": "session not found"}` — checked before any deletion happens. |
| `400` | `{"error": "..."}` — `through_seq` missing, non-numeric, or non-finite. |

```bash
curl -s -X DELETE 'localhost:4600/api/sessions/s1/events?through_seq=42'
# {"deleted":42,"session":{"id":"s1","label":null,"first_ts":..., ...}}
```

---

## Notes on things that are intentionally out of scope here

- No authentication — this is a local-only tool (server binds `127.0.0.1`
  by default; see `README.md`).
- No update/patch endpoints — events and sessions are append-only /
  delete-only.
- Retention (automatic pruning of old sessions) is a server-side background
  job, not an API surface — see `README.md#configuration`.
