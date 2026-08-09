import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createGame } from '../game/create.ts'
import { applyScore, undoLastScore } from '../game/score.ts'
import { db, schema } from '../db/index.ts'
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

async function findGame(code: string) {
  const [game] = await db()
    .select()
    .from(schema.games)
    .where(eq(schema.games.code, code.toUpperCase()))
  return game ?? null
}

/** The console's own view: teams, scores, and what undo would reverse. */
hostRouter.get('/games/:code', async (req, res) => {
  const game = await findGame(req.params.code)
  if (!game) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }

  const teams = await db()
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.gameId, game.id))
    .orderBy(asc(schema.teams.seat))

  const recentEvents = await db()
    .select()
    .from(schema.scoreEvents)
    .where(eq(schema.scoreEvents.gameId, game.id))
    .orderBy(desc(schema.scoreEvents.createdAt))
    .limit(10)

  res.json({ game, teams, recentEvents })
})

const createTeamSchema = z.object({
  name: z.string().min(1).max(60),
  pitch: z.string().max(300).optional(),
})

/**
 * Teams are created here, by hand, on purpose. Phones are an optional input
 * layer over a console that can run the whole game alone — so the host must be
 * able to seat five teams without a single phone joining.
 */
hostRouter.post('/games/:code/teams', async (req, res) => {
  const game = await findGame(req.params.code)
  if (!game) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }

  const parsed = createTeamSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Ugyldig lag',
      problems: parsed.error.issues.map((i) => i.message),
    })
    return
  }

  const existing = await db()
    .select({ seat: schema.teams.seat })
    .from(schema.teams)
    .where(eq(schema.teams.gameId, game.id))

  const nextSeat = existing.reduce((max, t) => Math.max(max, t.seat), -1) + 1

  const [team] = await db()
    .insert(schema.teams)
    .values({
      gameId: game.id,
      name: parsed.data.name,
      pitch: parsed.data.pitch ?? null,
      seat: nextSeat,
      // Issued even for a hand-made team, so a phone can claim it later.
      joinToken: randomUUID(),
    })
    .returning()

  res.json({ ok: true, team })
})

const scoreSchema = z.object({
  teamId: z.uuid(),
  delta: z.number().int(),
  note: z.string().max(200).optional(),
})

hostRouter.post('/games/:code/score', async (req, res) => {
  const game = await findGame(req.params.code)
  if (!game) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }

  const parsed = scoreSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Ugyldig poengendring' })
    return
  }

  try {
    const result = await applyScore({
      gameId: game.id,
      teamId: parsed.data.teamId,
      delta: parsed.data.delta,
      kind: 'manual',
      note: parsed.data.note ?? null,
    })
    res.json({ ok: true, ...result })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Kunne ikke endre poeng',
    })
  }
})

hostRouter.post('/games/:code/undo', async (req, res) => {
  const game = await findGame(req.params.code)
  if (!game) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }

  const teamId = typeof req.body?.teamId === 'string' ? req.body.teamId : undefined
  const result = await undoLastScore(game.id, teamId)

  if (!result) {
    res.status(404).json({ error: 'Ingenting å angre' })
    return
  }
  res.json({ ok: true, ...result })
})
