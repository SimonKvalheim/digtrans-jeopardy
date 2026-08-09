import { and, asc, eq } from 'drizzle-orm'
import {
  clampWager,
  maxDailyDoubleWager,
  scoreDelta,
  valueForTier,
} from '../../shared/scoring.ts'
import type { Tier } from '../../shared/pack-schema.ts'
import { db, schema } from '../db/index.ts'
import { applyScore } from './score.ts'

/**
 * The clue state machine (PRD §4.1), driven entirely from the host console.
 *
 * Exactly one steal per clue, and no chain: otherwise a single 500 eats five
 * minutes and the last team answers with four accumulated hints.
 */

export type Outcome =
  | 'own_correct'
  | 'own_wrong'
  | 'timeout'
  | 'steal_correct'
  | 'steal_wrong'
  | 'no_steal'

async function loadGame(code: string) {
  const [game] = await db()
    .select()
    .from(schema.games)
    .where(eq(schema.games.code, code.toUpperCase()))
  if (!game) throw new Error('Fant ikke spillet')
  return game
}

/** Clue content, including the answer. Host console only — never the board. */
export async function loadActiveClue(code: string) {
  const game = await loadGame(code)
  if (!game.activeClueId) return null

  const [row] = await db()
    .select({
      gameClueId: schema.gameClues.id,
      phase: schema.gameClues.phase,
      ownerTeamId: schema.gameClues.ownerTeamId,
      isDailyDouble: schema.gameClues.isDailyDouble,
      wager: schema.gameClues.wager,
      tier: schema.clues.tier,
      answer: schema.clues.answer,
      kind: schema.clues.kind,
      payload: schema.clues.payload,
      fromLabel: schema.clues.fromLabel,
      categoryName: schema.categories.name,
      valueStep: schema.rounds.valueStep,
    })
    .from(schema.gameClues)
    .innerJoin(schema.clues, eq(schema.clues.id, schema.gameClues.clueId))
    .innerJoin(
      schema.categories,
      eq(schema.categories.id, schema.clues.categoryId),
    )
    .innerJoin(schema.rounds, eq(schema.rounds.id, schema.categories.roundId))
    .where(eq(schema.gameClues.id, game.activeClueId))

  if (!row) return null

  return {
    ...row,
    value: valueForTier(row.tier as Tier, row.valueStep),
  }
}

/**
 * Opens a tile. The owning team is whoever's turn it is — they picked it, so
 * they answer first and the turn passes afterwards regardless of outcome.
 */
export async function openClue(code: string, gameClueId: string) {
  const game = await loadGame(code)

  return db().transaction(async (tx) => {
    const [gameClue] = await tx
      .select()
      .from(schema.gameClues)
      .where(
        and(
          eq(schema.gameClues.id, gameClueId),
          eq(schema.gameClues.gameId, game.id),
        ),
      )

    if (!gameClue) throw new Error('Fant ikke ruten')
    if (gameClue.phase !== 'closed') throw new Error('Ruten er allerede brukt')

    // A Daily Double goes to the wager screen before any clue text appears.
    const phase = gameClue.isDailyDouble ? 'dd_wager' : 'clue_open'

    await tx
      .update(schema.gameClues)
      .set({ phase, ownerTeamId: game.turnTeamId })
      .where(eq(schema.gameClues.id, gameClueId))

    await tx
      .update(schema.games)
      .set({ activeClueId: gameClueId, phase: 'clue' })
      .where(eq(schema.games.id, game.id))

    return { gameClueId, phase, isDailyDouble: gameClue.isDailyDouble }
  })
}

/**
 * Applies an outcome: moves the score and advances the clue's phase.
 *
 * `teamId` is required for a steal, because the stealing team is not the owner.
 * Everything else scores against the owner.
 */
export async function resolveClue(
  code: string,
  outcome: Outcome,
  teamId?: string,
) {
  const game = await loadGame(code)
  const active = await loadActiveClue(code)
  if (!active) throw new Error('Ingen aktiv rute')

  const value = active.isDailyDouble ? (active.wager ?? 0) : active.value

  let delta = 0
  let nextPhase: string
  let scoredTeamId = active.ownerTeamId

  switch (outcome) {
    case 'own_correct':
      delta = active.isDailyDouble
        ? scoreDelta({ kind: 'daily_double', correct: true, wager: value }, value)
        : scoreDelta({ kind: 'own', correct: true }, value)
      nextPhase = 'done'
      break
    case 'own_wrong':
    case 'timeout':
      delta = active.isDailyDouble
        ? scoreDelta({ kind: 'daily_double', correct: false, wager: value }, value)
        : scoreDelta({ kind: 'own', correct: false }, value)
      // A Daily Double is answered alone — there is never a steal.
      nextPhase = active.isDailyDouble ? 'revealed' : 'steal_open'
      break
    case 'steal_correct':
      if (!teamId) throw new Error('Stjeling krever et lag')
      delta = scoreDelta({ kind: 'steal', correct: true }, value)
      scoredTeamId = teamId
      nextPhase = 'done'
      break
    case 'steal_wrong':
      if (!teamId) throw new Error('Stjeling krever et lag')
      delta = scoreDelta({ kind: 'steal', correct: false }, value)
      scoredTeamId = teamId
      nextPhase = 'revealed'
      break
    case 'no_steal':
      // Triple stumper: nobody loses points, the room drinks instead.
      delta = 0
      nextPhase = 'revealed'
      break
  }

  if (delta !== 0 && scoredTeamId) {
    await applyScore({
      gameId: game.id,
      teamId: scoredTeamId,
      delta,
      kind: outcome.startsWith('steal')
        ? 'steal'
        : active.isDailyDouble
          ? 'daily_double'
          : 'own',
      clueId: active.gameClueId,
      note: outcome,
    })
  }

  await db()
    .update(schema.gameClues)
    .set({ phase: nextPhase as 'done' })
    .where(eq(schema.gameClues.id, active.gameClueId))

  return { outcome, delta, teamId: scoredTeamId, phase: nextPhase }
}

/**
 * Closes the current clue and passes the turn to the next seat. The turn moves
 * regardless of who answered, so the board keeps circulating.
 */
export async function closeClue(code: string) {
  const game = await loadGame(code)

  return db().transaction(async (tx) => {
    if (game.activeClueId) {
      await tx
        .update(schema.gameClues)
        .set({ phase: 'done' })
        .where(eq(schema.gameClues.id, game.activeClueId))
    }

    const teams = await tx
      .select({ id: schema.teams.id, seat: schema.teams.seat })
      .from(schema.teams)
      .where(eq(schema.teams.gameId, game.id))
      .orderBy(asc(schema.teams.seat))

    let nextTurn = game.turnTeamId
    if (teams.length > 0) {
      const currentIndex = teams.findIndex((t) => t.id === game.turnTeamId)
      nextTurn = teams[(currentIndex + 1) % teams.length]!.id
    }

    await tx
      .update(schema.games)
      .set({ activeClueId: null, phase: 'board', turnTeamId: nextTurn })
      .where(eq(schema.games.id, game.id))

    return { turnTeamId: nextTurn }
  })
}

/** Host override — used to set who picks first, and to fix mistakes. */
export async function setTurn(code: string, teamId: string) {
  const game = await loadGame(code)
  await db()
    .update(schema.games)
    .set({ turnTeamId: teamId })
    .where(eq(schema.games.id, game.id))
  return { turnTeamId: teamId }
}

/**
 * Locks the Daily Double wager, clamped server-side.
 *
 * The cap is the classic one (PRD §4.3): a team at or below zero may still
 * wager up to the round's top clue value, because otherwise the tile is dead
 * and the board stalls mid-round. The clamp lives here and not in the UI — the
 * wager will eventually arrive from a team phone, and a number off a phone is
 * never to be trusted.
 */
export async function setWager(code: string, wager: number) {
  const active = await loadActiveClue(code)
  if (!active) throw new Error('Ingen aktiv rute')
  if (!active.isDailyDouble) throw new Error('Ruten er ikke en dagens doble')
  if (active.phase !== 'dd_wager') throw new Error('Innsatsen er allerede låst')
  if (!active.ownerTeamId) throw new Error('Ruten har ingen eier')

  const [team] = await db()
    .select({ score: schema.teams.score })
    .from(schema.teams)
    .where(eq(schema.teams.id, active.ownerTeamId))

  if (!team) throw new Error('Fant ikke laget')

  const max = maxDailyDoubleWager(team.score, active.valueStep)
  const clamped = clampWager(wager, max)

  await db()
    .update(schema.gameClues)
    .set({ wager: clamped, phase: 'dd_answer' })
    .where(eq(schema.gameClues.id, active.gameClueId))

  return { wager: clamped, max, clamped: clamped !== Math.floor(wager) }
}

/** The legal range for the open Daily Double, so the console can show it. */
export async function wagerLimit(code: string) {
  const active = await loadActiveClue(code)
  if (!active?.isDailyDouble || !active.ownerTeamId) return null

  const [team] = await db()
    .select({ score: schema.teams.score })
    .from(schema.teams)
    .where(eq(schema.teams.id, active.ownerTeamId))

  if (!team) return null
  return {
    score: team.score,
    max: maxDailyDoubleWager(team.score, active.valueStep),
  }
}
