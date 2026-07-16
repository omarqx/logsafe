// Pure sparkline geometry for the jobs plugin — no React, no DOM.
import type { ThemeTokens } from '@coglet/logsafe-plugin-sdk/ui'
import type { JobRun } from './server'

export const MAX_SPARKLINE_POINTS = 120
export const SLOW_MS = 1000
const TOP_PAD = 4 // keep the max-duration point off the very top edge

export interface SparklinePoint { run: JobRun; x: number; y: number }
export interface SparklineOpts { width: number; height: number }

export function layoutSparkline(runs: JobRun[], opts: SparklineOpts): SparklinePoint[] {
  const kept = runs.slice(-MAX_SPARKLINE_POINTS) // input is ts ASC; newest kept
  if (kept.length === 0) return []
  const t0 = kept[0].ts
  const span = Math.max(1, kept[kept.length - 1].ts - t0)
  const maxDur = Math.max(1, ...kept.map((r) => r.duration_ms ?? 0))
  return kept.map((run) => ({
    run,
    x: ((run.ts - t0) / span) * opts.width,
    y: opts.height - ((run.duration_ms ?? 0) / maxDur) * (opts.height - TOP_PAD),
  }))
}

export function pointColor(r: JobRun, tokens: ThemeTokens): string {
  if (r.status === 'failed') return tokens.err
  if ((r.duration_ms ?? 0) > SLOW_MS) return tokens.amber
  return tokens.phos
}
