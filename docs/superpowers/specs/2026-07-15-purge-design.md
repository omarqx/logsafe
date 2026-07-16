# logsafe — Purge (hard clear): Design Spec

**Date:** 2026-07-15
**Status:** Approved in-session (soft `c` clear stays; purge added on top)

## Purpose

The `c` clear hides startup noise (view floor, reversible). Purge makes it
permanent: actually delete the hidden events. Two-step by design — soft
clear is the *preview* of the hard clear.

## API (additive change to the frozen contract — version note required)

`DELETE /api/sessions/:id/events?through_seq=N`

- Deletes all events in the session with `seq <= N` (inclusive —
  `through_seq` is deliberately NOT named `before_seq` to avoid confusion
  with the query API's exclusive `before_seq`; a destructive op gets
  self-documenting inclusive naming). This exactly matches what a floor
  `after=N` hides.
- In ONE transaction: delete the rows, then recompute the session row from
  survivors — `event_count`, `error_count`, `warn_count`, `first_ts` (min
  ts), `last_ts` (max ts), `sources` (sorted distinct). `label` unchanged.
- **If no events survive, the session row is deleted too** (a session with
  zero events is not representable — `first_ts`/`last_ts` are NOT NULL —
  and matches DELETE /api/sessions/:id semantics).
- Responses: `200 { deleted: n, session: <updated SessionSummary> | null }`
  (`session: null` = everything purged, session removed); `404` unknown
  session (JSON); `400` missing/non-finite `through_seq`.
- Safety notes: `seq` is AUTOINCREMENT (never reused), so held cursors /
  SSE resume points stay valid — a purge can never cause replays of wrong
  events, only smaller replays. The MCP stays READ-ONLY: no purge tool.
- API.md: add the endpoint section + a freeze-header version note
  (`2026-07-15: added DELETE /api/sessions/:id/events?through_seq= (purge).
  Existing routes/shapes unchanged.`).

## Server implementation

`purgeEventsThrough(db, sessionId, throughSeq): { deleted: number; sessionDeleted: boolean }`
in `packages/server/src/queries.ts` (transactional, prepared statements),
route in `app.ts` next to the existing DELETE route.

## UI

- `ui/src/api.ts`: `purgeEvents(id, throughSeq): Promise<{deleted: number; session: SessionSummary | null}>`.
- The `cleared` chip (present only when a floor is set) gains a `purge`
  action: `window.confirm("Permanently delete all events up to seq N in
  this session? This cannot be undone.")` → on confirm, call the API; on
  success remove `after` from the URL (the floor is now meaningless) and
  refetch — counts drop to the survivors. If `session: null` (everything
  purged), navigate to `/`.
- No one-keystroke destructive path (no `C` hard-clear key) — purge always
  goes through the chip + confirm.
- Cheat sheet: extend the `c` row: `…; purge on the chip deletes them
  permanently`.

## Testing

Server TDD: correct range deleted (boundary `seq <= N`), counters/ts/sources
recomputed from survivors, all-purged deletes session, 404/400 paths,
other sessions untouched. UI: chip shows purge only with floor; confirm-
declined = no call; confirm-accepted calls API, clears `after`, refetches.
Live walkthrough before ship (soft clear → purge → counts drop → restart
server → events still gone).
