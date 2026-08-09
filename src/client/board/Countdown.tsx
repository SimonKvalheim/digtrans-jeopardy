import { useEffect, useRef, useState } from 'react'
import { sting } from './audio.ts'

/** The last five seconds tick, and running out is audible. PRD §8.3. */
const TICK_FROM = 5

/**
 * The visible countdown (PRD §4.2).
 *
 * Driven off an absolute deadline from the server rather than a duration, so
 * it stays honest across the board's polling interval and resumes correctly
 * after a reload. The server is what actually applies the expiry — this is
 * purely the room's view of it.
 */
export function Countdown({
  endsAt,
  totalMs,
}: {
  endsAt: string
  totalMs: number
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // 10 Hz is smooth enough for a bar on a TV and costs nothing.
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [])

  const remaining = Math.max(0, new Date(endsAt).getTime() - now)
  const seconds = Math.ceil(remaining / 1000)
  const fraction = Math.max(0, Math.min(1, remaining / totalMs))
  const urgent = remaining <= 5000

  // One sound per whole second crossed, not one per 100 ms render.
  const lastSecond = useRef<number | null>(null)
  useEffect(() => {
    if (lastSecond.current === seconds) return
    const previous = lastSecond.current
    lastSecond.current = seconds
    // Nothing on the first render: a board reopened with four seconds left
    // should show four seconds, not fire a tick for arriving.
    if (previous === null) return
    if (seconds === 0) sting('timeUp')
    else if (seconds <= TICK_FROM) sting('tick')
  }, [seconds])

  return (
    <div className={`countdown${urgent ? ' countdown--urgent' : ''}`}>
      <div className="countdown__bar">
        <div
          className="countdown__fill"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      <span className="countdown__seconds">{seconds}</span>
    </div>
  )
}
