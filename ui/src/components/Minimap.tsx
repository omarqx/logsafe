// Vertical right-edge minimap strip (30px), ported from
// design/direction-a-session-detail.html (.minimap / .mm-density / .mm-err /
// .mm-view). Purely presentational: it renders whatever bins/errors/viewport
// geometry it's given and reports pointer interactions back as a fraction
// (0..1) of the strip's height, or an error's seq — SessionDetailPage owns
// the virtualizer and event list, and resolves those into an index/scroll.
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { MinimapBin } from '../lib/minimap'

export interface MinimapErrorMark {
  top: number // percentage 0..100, position along the strip
  seq: number // event seq this mark corresponds to (for the tooltip + jump)
}

export interface MinimapProps {
  bins: MinimapBin[]
  errors: MinimapErrorMark[]
  /** Viewport indicator geometry, percentages 0..100 of the strip's height. */
  viewportTop: number
  viewportHeight: number
  /** fraction is 0..1 of the strip's height, from a click or drag. */
  onJump: (fraction: number) => void
  onJumpToError: (seq: number) => void
}

export function Minimap({ bins, errors, viewportTop, viewportHeight, onJump, onJumpToError }: MinimapProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  // pointerId of a gesture that started on an error mark, or null. An error
  // mark's onPointerDown stops propagation so the strip's own
  // handlePointerDown never fires for that press — but without this, moving
  // the pointer off the mark mid-drag would still hit the strip's
  // onPointerMove directly (no propagation involved there) and start
  // scrubbing, silently turning "click an error" into "click an error, then
  // jump somewhere else" the moment the hand shakes. Tracked by pointerId
  // (not a boolean) so an unrelated second pointer isn't affected.
  const suppressScrubForPointerRef = useRef<number | null>(null)

  const fractionFromClientY = useCallback((clientY: number) => {
    const el = stripRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.height === 0) return 0
    return Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
  }, [])

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (suppressScrubForPointerRef.current === e.pointerId) return
      e.currentTarget.setPointerCapture(e.pointerId)
      onJump(fractionFromClientY(e.clientY))
    },
    [fractionFromClientY, onJump],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Only scrub while the primary button is held (drag), not on hover.
      if (e.buttons !== 1) return
      if (suppressScrubForPointerRef.current === e.pointerId) return
      onJump(fractionFromClientY(e.clientY))
    },
    [fractionFromClientY, onJump],
  )

  // Ends the suppressed gesture regardless of where the pointer lands (it
  // may no longer be over the mark that started it).
  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (suppressScrubForPointerRef.current === e.pointerId) {
      suppressScrubForPointerRef.current = null
    }
  }, [])

  return (
    <div
      className="minimap"
      ref={stripRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="cap">MAP</div>
      <div className="mm-density">
        {bins.map((bin, i) => (
          <i key={i} style={{ top: `${bin.top}%`, height: `${bin.height}%`, opacity: bin.intensity }} />
        ))}
      </div>
      {errors.map((mark) => (
        <div
          key={mark.seq}
          className="mm-err-hit"
          style={{ top: `${mark.top}%` }}
          title={`error · seq ${mark.seq}`}
          onPointerDown={(e) => {
            // Larger hit area than the visual bar; jump straight to this
            // error rather than the generic proportional-fraction jump.
            e.stopPropagation()
            suppressScrubForPointerRef.current = e.pointerId
            onJumpToError(mark.seq)
          }}
        >
          <span className="mm-err" />
        </div>
      ))}
      <div className="mm-view" style={{ top: `${viewportTop}%`, height: `${viewportHeight}%` }} />
    </div>
  )
}
