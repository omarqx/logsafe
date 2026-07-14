// Pure event -> minimap geometry. No DOM, no fetch, no react.
// All positions/sizes are percentages (0..100) of the minimap's height.

export interface MinimapBin {
  top: number
  height: number
  intensity: number
}

export interface MinimapMark {
  top: number
}

/**
 * Buckets `events` into `binCount` equal-width time slices spanning
 * [min ts, max ts], returning only the non-empty bins (density map) plus a
 * mark for every 'error'-level event's position on the timeline.
 */
export function binEvents(
  events: { ts: number; level: string }[],
  binCount: number,
): { bins: MinimapBin[]; errors: MinimapMark[] } {
  if (events.length === 0 || binCount <= 0) {
    return { bins: [], errors: [] }
  }

  let min = Infinity
  let max = -Infinity
  for (const e of events) {
    if (e.ts < min) min = e.ts
    if (e.ts > max) max = e.ts
  }
  const span = max - min

  const counts = new Array<number>(binCount).fill(0)
  const errors: MinimapMark[] = []

  for (const e of events) {
    const frac = span === 0 ? 0 : (e.ts - min) / span
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(frac * binCount)))
    counts[idx]++
    if (e.level === 'error') {
      errors.push({ top: frac * 100 })
    }
  }

  const maxCount = Math.max(...counts, 1)
  const binHeight = 100 / binCount
  const bins: MinimapBin[] = []
  for (let i = 0; i < binCount; i++) {
    if (counts[i] === 0) continue
    bins.push({
      top: i * binHeight,
      height: binHeight,
      intensity: counts[i] / maxCount,
    })
  }

  return { bins, errors }
}
