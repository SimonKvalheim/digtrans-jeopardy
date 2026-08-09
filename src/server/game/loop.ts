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
import { closeSteal, openSteal } from './buzz.ts'
import { notifyChanged } from '../ws/hub.ts'

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

/** Timers from PRD §4.2. The Final's 60s belongs to Final Jeopardy, not here. */
export const CLUE_MS = 30_000
export const STEAL_MS = 10_000

/**
 * Applies a countdown that has run out.
 *
 * Called from the read paths, so it fires within one poll without needing a
 * background scheduler that a redeploy would kill. Every transition is a
 * conditional update guarded on the phase it is leaving, and the score only
 * moves if that update actually changed a row — the board and the console both
 * poll, and without the guard an expiry would penalise a team twice.
 */
export async function applyExpiry(code: string) {
  const game = await loadGame(code)
  if (!game.activeClueId) return null

  const [row] = await db()
    .select({
      id: schema.gameClues.id,
      phase: schema.gameClues.phase,
      phaseEndsAt: schema.gameClues.phaseEndsAt,
      ownerTeamId: schema.gameClues.ownerTeamId,
      isDailyDouble: schema.gameClues.isDailyDouble,
      tier: schema.clues.tier,
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

  // No deadline means untimed, or paused by the host.
  if (!row?.phaseEndsAt) return null
  if (row.phaseEndsAt.getTime() > Date.now()) return null

  if (row.phase === 'clue_open') {
    const won = await db()
      .update(schema.gameClues)
      .set({
        phase: 'steal_open',
        phaseEndsAt: new Date(Date.now() + STEAL_MS),
      })
      .where(
        and(
          eq(schema.gameClues.id, row.id),
          eq(schema.gameClues.phase, 'clue_open'),
        ),
      )
      .returning({ id: schema.gameClues.id })

    if (won.length === 0) return null

    openSteal(game.id, row.id)
    notifyChanged(game.id)

    // Timing out is treated exactly as an owner miss: half the value.
    const value = valueForTier(row.tier as Tier, row.valueStep)
    if (row.ownerTeamId) {
      await applyScore({
        gameId: game.id,
        teamId: row.ownerTeamId,
        delta: scoreDelta({ kind: 'timeout' }, value),
        kind: 'own',
        clueId: row.id,
        note: 'timeout',
      })
    }
    return 'timeout'
  }

  if (row.phase === 'steal_open') {
    const won = await db()
      .update(schema.gameClues)
      .set({ phase: 'revealed', phaseEndsAt: null })
      .where(
        and(
          eq(schema.gameClues.id, row.id),
          eq(schema.gameClues.phase, 'steal_open'),
        ),
      )
      .returning({ id: schema.gameClues.id })

    if (won.length === 0) return null
    closeSteal(game.id)
    notifyChanged(game.id)
    // Triple stumper: nobody loses points, the room drinks instead.
    return 'no_steal'
  }

  return null
}

/**
 * Host override on the clock (PRD §4.2: "host can always override"). Pausing
 * clears the deadline entirely, which is also what makes a clue untimed while
 * someone argues.
 */
export async function adjustTimer(
  code: string,
  action: 'extend' | 'pause' | 'restart',
) {
  const game = await loadGame(code)
  if (!game.activeClueId) throw new Error('Ingen aktiv rute')

  const [row] = await db()
    .select({
      phase: schema.gameClues.phase,
      phaseEndsAt: schema.gameClues.phaseEndsAt,
    })
    .from(schema.gameClues)
    .where(eq(schema.gameClues.id, game.activeClueId))

  if (!row) throw new Error('Fant ikke ruten')

  const base = row.phase === 'steal_open' ? STEAL_MS : CLUE_MS
  let phaseEndsAt: Date | null

  switch (action) {
    case 'pause':
      phaseEndsAt = null
      break
    case 'restart':
      phaseEndsAt = new Date(Date.now() + base)
      break
    case 'extend':
      // From now if the clock was paused, otherwise from what is left.
      phaseEndsAt = new Date(
        Math.max(Date.now(), row.phaseEndsAt?.getTime() ?? Date.now()) + 15_000,
      )
      break
  }

  await db()
    .update(schema.gameClues)
    .set({ phaseEndsAt })
    .where(eq(schema.gameClues.id, game.activeClueId))

  return { phaseEndsAt }
}

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
      phaseEndsAt: schema.gameClues.phaseEndsAt,
      ownerTeamId: schema.gameClues.ownerTeamId,
      stealTeamId: schema.gameClues.stealTeamId,
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
      .set({
        phase,
        ownerTeamId: game.turnTeamId,
        // Wagering is untimed on purpose — it is a negotiation with the room,
        // not a race, and the clue text has not been shown yet.
        phaseEndsAt: gameClue.isDailyDouble
          ? null
          : new Date(Date.now() + CLUE_MS),
      })
      .where(eq(schema.gameClues.id, gameClueId))

    await tx
      .update(schema.games)
      .set({ activeClueId: gameClueId, phase: 'clue' })
      .where(eq(schema.games.id, game.id))

    closeSteal(game.id)
    notifyChanged(game.id)
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
    case 'steal_wrong': {
      // Whoever won the buzz race is the default; the host may still override
      // it, because a console that cannot correct the machine is a trap.
      const stealer = teamId ?? active.stealTeamId
      if (!stealer) throw new Error('Stjeling krever et lag')
      const correct = outcome === 'steal_correct'
      delta = scoreDelta({ kind: 'steal', correct }, value)
      scoredTeamId = stealer
      nextPhase = correct ? 'done' : 'revealed'
      break
    }
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
    .set({
      phase: nextPhase as 'done',
      // The steal window is the only phase this can open onto; everything else
      // is terminal and untimed.
      phaseEndsAt:
        nextPhase === 'steal_open' ? new Date(Date.now() + STEAL_MS) : null,
    })
    .where(eq(schema.gameClues.id, active.gameClueId))

  if (nextPhase === 'steal_open') openSteal(game.id, active.gameClueId)
  else closeSteal(game.id)
  notifyChanged(game.id)

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

    closeSteal(game.id)
    notifyChanged(game.id)

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
