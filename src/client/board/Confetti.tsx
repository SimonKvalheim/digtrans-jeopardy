import { useEffect, useRef } from 'react'

/**
 * Winner confetti (PRD §8.4), hand-rolled onto a canvas.
 *
 * A confetti library is 15 kB of dependency for one moment of one evening, and
 * this is thirty lines of physics. Board only, and it stops on its own — a
 * canvas animating for the rest of the night on a borrowed laptop is how you
 * discover the fans work.
 */
const COLOURS = ['#ffcc00', '#fff5cf', '#4aa8ff', '#ff5a5a', '#3ddc84', '#ffffff']
const COUNT = 160
const RUN_MS = 9000

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  spin: number
  w: number
  h: number
  colour: string
}

export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const { width, height } = canvas
    const pieces: Piece[] = Array.from({ length: COUNT }, (_, i) => ({
      x: (i / COUNT) * width,
      // Staggered above the top edge, so it falls in as a curtain rather than
      // arriving as one line.
      y: -Math.random() * height,
      vx: (Math.random() - 0.5) * 1.4,
      vy: 2.2 + Math.random() * 3.4,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.24,
      w: 10 + Math.random() * 14,
      h: 16 + Math.random() * 20,
      colour: COLOURS[i % COLOURS.length]!,
    }))

    let raf = 0
    let t0: number | null = null

    const frame = (now: number) => {
      t0 ??= now
      const elapsed = now - t0
      ctx.clearRect(0, 0, width, height)

      for (const p of pieces) {
        p.x += p.vx
        p.y += p.vy
        p.rot += p.spin
        // Wrap rather than respawn, so the curtain keeps its density.
        if (p.y > height + p.h) p.y = -p.h

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.globalAlpha = Math.max(0, 1 - elapsed / RUN_MS)
        ctx.fillStyle = p.colour
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      if (elapsed < RUN_MS) raf = requestAnimationFrame(frame)
      else ctx.clearRect(0, 0, width, height)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas ref={ref} className="confetti" width={1920} height={1080} aria-hidden="true" />
  )
}
