import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createGame } from '../game/create.ts'
import { applyScore, undoLastScore } from '../game/score.ts'
import {
  adjustTimer,
  applyExpiry,
  closeClue,
  loadActiveClue,
  openClue,
  resolveClue,
  setTurn,
  setWager,
  wagerLimit,
} from '../game/loop.ts'
import { buildBoardState } from '../game/state.ts'
import { roundProgress, setLobby, setRound, setScreen } from '../game/rounds.ts'
import {
  finalState,
  finishFinal,
  judgeFinal,
  openFinalReveal,
  revealFinalClue,
  startFinal,
} from '../game/final.ts'
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

/** The host's board: same tiles as the TV, plus what the console needs. */
hostRouter.get('/games/:code/board', async (req, res) => {
  const state = await buildBoardState(req.params.code)
  if (!state) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }
  res.json(state)
})

/** Clue content including the answer. This is why /host is PIN-gated. */
hostRouter.get('/games/:code/active', async (req, res) => {
  try {
    // Same reason as the board: countdowns land on read, so this runs first.
    await applyExpiry(req.params.code)
    const [active, limit] = await Promise.all([
      loadActiveClue(req.params.code),
      wagerLimit(req.params.code),
    ])
    res.json({ active, wagerLimit: limit })
  } catch (error) {
    res.status(404).json({
      error: error instanceof Error ? error.message : 'Ukjent feil',
    })
  }
})

const wrap = (fn: () => Promise<unknown>) => async (_req: unknown, res: Response) => {
  try {
    res.json({ ok: true, ...(await fn() as object) })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Ukjent feil',
    })
  }
}

hostRouter.post('/games/:code/open', (req, res) =>
  wrap(() => openClue(req.params.code, String(req.body?.gameClueId)))(req, res),
)

const resolveSchema = z.object({
  outcome: z.enum([
    'own_correct',
    'own_wrong',
    'timeout',
    'steal_correct',
    'steal_wrong',
    'no_steal',
  ]),
  teamId: z.uuid().optional(),
})

hostRouter.post('/games/:code/resolve', async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Ugyldig utfall' })
    return
  }
  await wrap(() =>
    resolveClue(req.params.code, parsed.data.outcome, parsed.data.teamId),
  )(req, res)
})

hostRouter.post('/games/:code/close', (req, res) =>
  wrap(() => closeClue(req.params.code))(req, res),
)

/** Every round in the pack with tonight's progress, for the round switcher. */
hostRouter.get('/games/:code/rounds', async (req, res) => {
  try {
    res.json({ rounds: await roundProgress(req.params.code) })
  } catch (error) {
    res.status(404).json({
      error: error instanceof Error ? error.message : 'Ukjent feil',
    })
  }
})

/** Puts the room code and its QR back on the TV, or takes them down. */
hostRouter.post('/games/:code/lobby', (req, res) =>
  wrap(() => setLobby(req.params.code, Boolean(req.body?.open)))(req, res),
)

const screenSchema = z.object({ screen: z.enum(['studio', 'plain']) })

/** Studio set or bare board on the TV. Legal in every phase — it is a
    presentation choice, not a move in the game. */
hostRouter.post('/games/:code/screen', (req, res) => {
  const parsed = screenSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Ugyldig visning' })
    return
  }
  return wrap(() => setScreen(req.params.code, parsed.data.screen))(req, res)
})

/** No body advances to the next round; a roundId jumps to that one. */
hostRouter.post('/games/:code/round', (req, res) =>
  wrap(() =>
    setRound(
      req.params.code,
      typeof req.body?.roundId === 'string' ? req.body.roundId : undefined,
    ),
  )(req, res),
)

hostRouter.post('/games/:code/turn', (req, res) =>
  wrap(() => setTurn(req.params.code, String(req.body?.teamId)))(req, res),
)

hostRouter.post('/games/:code/wager', (req, res) =>
  wrap(() => setWager(req.params.code, Number(req.body?.wager)))(req, res),
)

// ── Final Jeopardy ──────────────────────────────────────────────────────────

hostRouter.get('/games/:code/final', async (req, res) => {
  try {
    // The host is the one surface allowed the answer key.
    res.json(await finalState(req.params.code, true))
  } catch (error) {
    res.status(404).json({
      error: error instanceof Error ? error.message : 'Ukjent feil',
    })
  }
})

hostRouter.post('/games/:code/final/start', (req, res) =>
  wrap(() => startFinal(req.params.code))(req, res),
)

hostRouter.post('/games/:code/final/reveal', (req, res) =>
  wrap(() => revealFinalClue(req.params.code))(req, res),
)

hostRouter.post('/games/:code/final/collect', (req, res) =>
  wrap(() => openFinalReveal(req.params.code))(req, res),
)

const judgeSchema = z.object({ teamId: z.uuid(), correct: z.boolean() })

hostRouter.post('/games/:code/final/judge', async (req, res) => {
  const parsed = judgeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Ugyldig dom' })
    return
  }
  await wrap(() =>
    judgeFinal(req.params.code, parsed.data.teamId, parsed.data.correct),
  )(req, res)
})

hostRouter.post('/games/:code/final/finish', (req, res) =>
  wrap(() => finishFinal(req.params.code))(req, res),
)

const timerSchema = z.object({
  action: z.enum(['extend', 'pause', 'restart']),
})

hostRouter.post('/games/:code/timer', async (req, res) => {
  const parsed = timerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Ugyldig klokkehandling' })
    return
  }
  await wrap(() => adjustTimer(req.params.code, parsed.data.action))(req, res)
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
