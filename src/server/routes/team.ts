import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { notifyChanged } from '../ws/hub.ts'
import { finalState, lockFinalAnswer, lockFinalWager } from '../game/final.ts'

/**
 * Team phones. No PIN: the room code is the only thing gating this, and the
 * surface never sees a clue answer.
 */
export const teamRouter = Router()

const joinSchema = z.object({
  code: z.string().min(3).max(6),
  name: z.string().min(1).max(60),
  pitch: z.string().max(300).optional(),
})

async function gameByCode(code: string) {
  const [game] = await db()
    .select()
    .from(schema.games)
    .where(eq(schema.games.code, code.toUpperCase()))
  return game ?? null
}

/**
 * Join, or claim a team the host already seated by hand.
 *
 * Claiming matters because the console can run the whole game alone — so by
 * the time phones arrive, the teams may already exist. Matching on name lets a
 * phone attach to its team rather than creating a duplicate.
 */
teamRouter.post('/join', async (req, res) => {
  const parsed = joinSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Sjekk romkode og lagnavn' })
    return
  }

  const game = await gameByCode(parsed.data.code)
  if (!game) {
    res.status(404).json({ error: 'Fant ikke rommet' })
    return
  }

  const name = parsed.data.name.trim()

  const existing = await db()
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.gameId, game.id))

  const claimed = existing.find(
    (t) => t.name.toLowerCase() === name.toLowerCase(),
  )

  if (claimed) {
    notifyChanged(game.id)
    res.json({
      joinToken: claimed.joinToken,
      teamId: claimed.id,
      name: claimed.name,
      claimed: true,
    })
    return
  }

  const seat = existing.reduce((max, t) => Math.max(max, t.seat), -1) + 1
  const joinToken = randomUUID()

  const [team] = await db()
    .insert(schema.teams)
    .values({
      gameId: game.id,
      name,
      pitch: parsed.data.pitch ?? null,
      seat,
      joinToken,
    })
    .returning()

  notifyChanged(game.id)
  res.json({ joinToken, teamId: team!.id, name: team!.name, claimed: false })
})

/**
 * Restores a phone from its stored token.
 *
 * Over two hours every phone will sleep and drop its socket. Without this the
 * game dies twenty minutes in, so it is deliberately the cheapest call in the
 * system: one indexed lookup, no PIN, no round trip to the host.
 */
teamRouter.get('/me', async (req, res) => {
  const token = req.get('x-join-token') ?? ''
  if (!token) {
    res.status(401).json({ error: 'Mangler token' })
    return
  }

  const [team] = await db()
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.joinToken, token))

  if (!team) {
    res.status(404).json({ error: 'Ukjent token' })
    return
  }

  const [game] = await db()
    .select({
      id: schema.games.id,
      code: schema.games.code,
      phase: schema.games.phase,
    })
    .from(schema.games)
    .where(eq(schema.games.id, team.gameId))

  // What the phone shows: its own team, and whether it may buzz right now.
  const [openClue] = await db()
    .select({
      id: schema.gameClues.id,
      phase: schema.gameClues.phase,
      ownerTeamId: schema.gameClues.ownerTeamId,
      stealTeamId: schema.gameClues.stealTeamId,
      phaseEndsAt: schema.gameClues.phaseEndsAt,
    })
    .from(schema.gameClues)
    .innerJoin(schema.games, eq(schema.games.activeClueId, schema.gameClues.id))
    .where(
      and(
        eq(schema.games.id, team.gameId),
        eq(schema.gameClues.gameId, team.gameId),
      ),
    )

  const stealOpen = openClue?.phase === 'steal_open'

  res.json({
    team: { id: team.id, name: team.name, score: team.score, seat: team.seat },
    game,
    // The owning team may not steal from itself.
    canBuzz: stealOpen && openClue?.ownerTeamId !== team.id,
    stealWinnerTeamId: openClue?.stealTeamId ?? null,
    // During the Final there is no active clue, so the game's own phase is
    // what tells the phone which screen to show.
    phase: game!.phase.startsWith('final')
      ? game!.phase
      : (openClue?.phase ?? 'board'),
    phaseEndsAt: openClue?.phaseEndsAt?.toISOString() ?? null,
  })
})

// ── Final Jeopardy from the phone ──────────────────────────────────────────

const wagerSchema = z.object({ wager: z.number().int() })
const answerSchema = z.object({ answer: z.string().min(1).max(300) })

teamRouter.post('/final/wager', async (req, res) => {
  const token = req.get('x-join-token') ?? ''
  const parsed = wagerSchema.safeParse(req.body)
  if (!token || !parsed.success) {
    res.status(400).json({ error: 'Ugyldig innsats' })
    return
  }
  try {
    res.json({ ok: true, ...(await lockFinalWager(token, parsed.data.wager)) })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Ukjent feil',
    })
  }
})

teamRouter.post('/final/answer', async (req, res) => {
  const token = req.get('x-join-token') ?? ''
  const parsed = answerSchema.safeParse(req.body)
  if (!token || !parsed.success) {
    res.status(400).json({ error: 'Skriv et svar' })
    return
  }
  try {
    res.json({ ok: true, ...(await lockFinalAnswer(token, parsed.data.answer)) })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Ukjent feil',
    })
  }
})

/**
 * What this phone needs for the Final: its own wager cap and lock state.
 * Never the clue text — that is on the TV, which is what keeps heads up.
 */
teamRouter.get('/final', async (req, res) => {
  const token = req.get('x-join-token') ?? ''
  const [team] = await db()
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.joinToken, token))

  if (!team) {
    res.status(404).json({ error: 'Ukjent token' })
    return
  }

  const [game] = await db()
    .select({ code: schema.games.code })
    .from(schema.games)
    .where(eq(schema.games.id, team.gameId))

  const state = await finalState(game!.code, false)
  const mine = state.bets.find((b) => b.teamId === team.id) ?? null

  res.json({
    phase: state.phase,
    playing: Boolean(mine),
    maxWager: Math.max(0, team.score),
    mine,
  })
})
