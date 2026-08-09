import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { env } from './env.ts'

/**
 * The only auth in the system: two PINs, typed once per device and kept in
 * localStorage (PRD §3.1). On a public Railway URL /host is otherwise one
 * guess away from a room full of students who would love to see the answers.
 *
 * Compared through a SHA-256 digest so the comparison is constant-time and
 * independent of length — a short PIN should not be detectable from timing.
 */
function pinMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== 'string' || supplied.length === 0) return false
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function requirePin(which: 'host' | 'admin') {
  return (req: Request, res: Response, next: NextFunction) => {
    const expected = which === 'host' ? env.HOST_PIN : env.ADMIN_PIN

    if (!expected) {
      res.status(503).json({
        error: `${which.toUpperCase()}_PIN er ikke satt på serveren`,
      })
      return
    }

    const supplied = req.get('x-pin') ?? ''
    if (!pinMatches(supplied, expected)) {
      res.status(401).json({ error: 'Feil PIN' })
      return
    }

    next()
  }
}

export const requireHostPin = requirePin('host')
export const requireAdminPin = requirePin('admin')
