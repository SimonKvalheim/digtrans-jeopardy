import { useEffect, useState } from 'react'

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
