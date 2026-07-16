// Pure timeline geometry for the http plugin's detail view — no React, no
// DOM, unit-testable. Maps request rows onto an SVG-ready layout.
import type { ThemeTokens } from '@coglet/logsafe-plugin-sdk/ui'
import type { HttpRequestRow } from './server'

export const MAX_TIMELINE_ROWS = 40
export const SLOW_MS = 1000
const MIN_BAR_PX = 2
// Widest bar (the max-latency request) takes this fraction of the axis.
const MAX_BAR_FRACTION = 0.35

export interface TimelineRow {
  request: HttpRequestRow
  x: number
  width: number
  y: number
}

export interface TimelineOpts {
  width: number      // total SVG width
  axisStart: number  // x where the time axis begins (label gutter to the left)
}

export function layoutTimeline(requests: HttpRequestRow[], opts: TimelineOpts): TimelineRow[] {
  const kept = requests.slice(-MAX_TIMELINE_ROWS) // newest wins (input is ts ASC)
  if (kept.length === 0) return []
  const t0 = kept[0].ts
  const span = Math.max(1, kept[kept.length - 1].ts - t0) // avoid /0 for a single request
  const axisWidth = opts.width - opts.axisStart
  const maxLatency = Math.max(1, ...kept.map((r) => r.latency_ms ?? 0))
  return kept.map((request, i) => ({
    request,
    x: opts.axisStart + ((request.ts - t0) / span) * axisWidth,
    width: Math.max(MIN_BAR_PX, ((request.latency_ms ?? 0) / maxLatency) * axisWidth * MAX_BAR_FRACTION),
    y: i,
  }))
}

export function barColor(r: HttpRequestRow, tokens: ThemeTokens): string {
  if (r.status !== null && r.status >= 500) return tokens.err
  if ((r.status !== null && r.status >= 400) || (r.latency_ms ?? 0) > SLOW_MS) return tokens.amber
  return tokens.phos
}
