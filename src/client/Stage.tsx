import { useEffect, useRef, type ReactNode } from 'react'

const STAGE_W = 1920
const STAGE_H = 1080

/**
 * Letterboxes a fixed 1920×1080 board into whatever the TV actually reports,
 * so board code can be written in absolute pixels and never think about
 * breakpoints. Rescales on resize and on orientation change, which also covers
 * the "someone unplugs and replugs the HDMI" case.
 */
export function Stage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const fit = () => {
      const scale = Math.min(
        window.innerWidth / STAGE_W,
        window.innerHeight / STAGE_H,
      )
      el.style.transform = `scale(${scale})`
    }

    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <div className="stage-viewport">
      <div className="stage" ref={ref}>
        {children}
      </div>
    </div>
  )
}
