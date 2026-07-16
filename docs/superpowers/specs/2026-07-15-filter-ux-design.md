# logsafe — Filter UX batch: Design Spec

**Date:** 2026-07-15
**Status:** Approved in-session (autocomplete + backspace-chip + clear floor)

Three UI features reducing filter friction. No server/API changes — the
frozen contract already provides every primitive needed.

## 1. Filter autocomplete (CmdBar)

Dropdown under the `❯` input, entirely client-side.

- **Engine:** pure `suggest(token, ctx)` in `ui/src/lib/suggest.ts` where
  `token` is the whitespace-separated word being typed and
  `ctx = { sources, nsValues, traceValues }`.
  - Bare/partial word → key prefixes `ns:` `level:` `source:` `trace:` `q:`
    (prefix-filtered), each with a one-line hint.
  - `level:` → `debug|info|warn|error`, comma-aware (`level:warn,` suggests
    completions for the segment after the last comma).
  - `source:` → `ctx.sources` (from the session summary — authoritative),
    comma-aware.
  - `ns:` → `ctx.nsValues` (distinct ns of loaded events) prefix-matched,
    plus a `<partial>*` glob suggestion when partial is non-empty;
    comma-aware. Known caveat: nsValues derive from currently loaded
    (filtered) events — acceptable, documented.
  - `trace:` → `ctx.traceValues` (distinct, most recent first, cap 8).
  - `q:` / free text → no suggestions.
  - Results capped at 8. Case-insensitive matching.
- **Interaction:** `↓/↑` move highlight (starts unhighlighted), `Tab`/`Enter`
  accept the highlighted suggestion (replacing the current token; value
  completions append a trailing space, key completions don't), `Enter` with
  no highlight commits the input as today, `Esc` closes the dropdown first
  (second Esc blurs), mouse click accepts. Phosphor-styled monospace panel.

## 2. Backspace removes the last filter chip

With the input **empty**, Backspace removes the last displayed chip
(display order: after/clear, ns, level, source, trace, q — remove the last
present). With text in the input, Backspace edits text normally.

## 3. Clear — non-destructive seq floor (`c`)

Terminal-style clear for startup noise:

- `c` in the session detail sets `after=<newest loaded seq>` in the URL
  (history push — back button undoes). The stream, minimap, and shown
  counts then include only events with `seq > after`.
- Rendered as a removable `cleared` chip (title shows the seq); removing it
  restores everything. Nothing is deleted server-side.
- Pinned rows survive (pins resolve by seq independently).
- Plumbing: `after` joins the URL `Filters`; `useEventStream` takes it as
  the INITIAL load cursor / lastSeq floor (it is NOT an ordinary per-page
  api param — the hook owns per-page after_seq cursors). Tail and the
  sparse-filter probe compose naturally (cursor starts ≥ floor).
- Not typeable in the cmd input (set via `c` / URL only) — keeps the
  parser's key set unchanged.

## Docs

Cheat sheet gains: autocomplete hint, `⌫` (empty input) removes last
filter, `c` clear. All claims must be live-verified before ship (the q:
lesson).

## Testing

Unit: suggest engine matrix; cmdInput unchanged; filters round-trip with
`after`; useEventStream floor-cursor test (first fetch uses
after_seq=floor). Component: CmdBar accept-suggestion and
backspace-chip-removal. Live walkthrough before push.
