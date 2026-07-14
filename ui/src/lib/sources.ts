// Pure source -> color-slot assignment. No DOM, no fetch, no react.
// Actual color values live in theme.css; this just picks a stable slot 0..5.

const SEEDED_ORDER = ['webapp', 'api'] as const
const COLOR_SLOTS = 6

/**
 * Returns a stable color slot (0..5) for `source` within `sources`.
 * 'webapp' and 'api' are pre-seeded to slots 0 and 1 whenever present, so
 * demo data always matches the mockups regardless of first-appearance order.
 * Remaining sources fill the rest of the slots in first-appearance order,
 * wrapping around modulo 6 past the sixth distinct source.
 */
export function sourceColorIndex(sources: string[], source: string): number {
  const order: string[] = []
  for (const seed of SEEDED_ORDER) {
    if (sources.includes(seed)) order.push(seed)
  }
  for (const s of sources) {
    if (!order.includes(s)) order.push(s)
  }
  const idx = order.indexOf(source)
  const resolved = idx === -1 ? order.length : idx
  return resolved % COLOR_SLOTS
}
