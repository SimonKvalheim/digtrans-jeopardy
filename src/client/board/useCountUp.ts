import { useEffect, useRef, useState } from 'react'

/**
 * Runs a score from its old value to its new one (PRD §8.4).
 *
 * Not only decoration: a score that jumps is a score nobody watched change, and
 * then half the room is asking whether the 400 was applied. A number that
 * visibly climbs answers that without anyone having to ask.
 */
export function useCountUp(target: number, durationMs = 650): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const frame = useRef(0)

  useEffect(() => {
    const start = from.current
    if (start === target) return

    // Time comes from the animation frame rather than Date.now(), so a board
    // that was backgrounded resumes cleanly instead of jumping.
    let t0: number | null = null

    const step = (now: number) => {
      t0 ??= now
      const p = Math.min(1, (now - t0) / durationMs)
      // Ease-out: the interesting part of a score change is where it lands.
      const eased = 1 - (1 - p) ** 3
      setShown(Math.round(start + (target - start) * eased))
      if (p < 1) frame.current = requestAnimationFrame(step)
      else from.current = target
    }

    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [target, durationMs])

  return shown
}
