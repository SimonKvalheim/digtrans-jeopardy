import { Router } from 'express'
import { z } from 'zod'
import { createGame } from '../game/create.ts'
import { requireHostPin } from '../auth.ts'

/**
 * The host console's API. Everything here is PIN-gated, because it is the one
 * surface that can see answers and move scores.
 */
export const hostRouter = Router()

hostRouter.use(requireHostPin)

const createGameSchema = z.object({
  packSlug: z.string().min(1),
  code: z
    .string()
    .regex(/^[A-Za-z0-9]{3,6}$/, 'koden må være 3–6 bokstaver eller tall')
    .optional(),
})

hostRouter.post('/games', async (req, res) => {
  const parsed = createGameSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Ugyldig forespørsel',
      problems: parsed.error.issues.map((i) => i.message),
    })
    return
  }

  try {
    const game = await createGame(parsed.data)
    res.json({ ok: true, ...game })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Kunne ikke lage spill',
    })
  }
})

/** Confirms the PIN without doing anything, so the console can gate its UI. */
hostRouter.post('/session', (_req, res) => {
  res.json({ ok: true })
})
