import { useEffect, useRef, type ReactNode } from 'react'
import { StudioScene } from './board/StudioScene.tsx'

const STAGE_W = 1920
const STAGE_H = 1080

/**
 * Letterboxes a fixed 1920×1080 board into whatever the TV actually reports,
 * so board code can be written in absolute pixels and never think about
 * breakpoints. Rescales on resize and on orientation change, which also covers
 * the "someone unplugs and replugs the HDMI" case.
 *
 * The studio set is drawn here rather than inside the board: it is a room the
 * board sits in, it never changes between phases, and every phase (grid, clue,
 * final, lobby) should keep the same walls behind it. `scene` only cross-fades
 * it — the board itself stays mounted, so switching views mid-clue never
 * restarts a countdown.
 */
export function Stage({
  children,
  scene = true,
}: {
  children: ReactNode
  scene?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const fit = () => {
      const scale = Math.min(
        window.innerWidth / STAGE_W,
        window.innerHeight / STAGE_H,
      )
      // Offset in pixels, not percentages: a percentage translate resolves
      // against the element's unscaled 1920×1080 box, so it overshoots by
      // exactly the scale factor and the board drifts off-centre.
      const x = (window.innerWidth - STAGE_W * scale) / 2
      const y = (window.innerHeight - STAGE_H * scale) / 2
      el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    }

    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <div className="stage-viewport">
      <div
        className={`stage ${scene ? 'stage--scene' : 'stage--plain'}`}
        ref={ref}
      >
        <StudioScene />
        {children}
      </div>
    </div>
  )
}
