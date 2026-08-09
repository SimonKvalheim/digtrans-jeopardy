import { and, asc, eq } from 'drizzle-orm'
import { clampWager, maxFinalWager, playsFinal } from '../../shared/scoring.ts'
import { db, schema } from '../db/index.ts'
import { applyScore } from './score.ts'
import { notifyChanged } from '../ws/hub.ts'

/**
 * Final Jeopardy (PRD §2.6, §4.3).
 *
 * Fully blind: no category is shown before the wager, which is a deliberate
 * break from the show. That is only true if the wager locks before the clue is
 * fetched at all, so this runs as two phases and the clue text is never in a
 * payload during the wager phase.
 *
 * A team at or below zero does not play. They didn't earn a shot at the win,
 * and the board shows them eliminated rather than quietly skipping them.
 */

export const FINAL_MS = 60_000

export type FinalPhase =
  | 'final_wager'
  | 'final_clue'
  | 'final_reveal'
  | 'final_done'

async function loadGame(code: string) {
  const [game] = await db()
    .select()
    .from(schema.games)
    .where(eq(schema.games.code, code.toUpperCase()))
  if (!game) throw new Error('Fant ikke spillet')
  return game
}

/** The pack's final round, and the single clue inside it. */
async function finalClue(packId: string) {
  const [row] = await db()
    .select({
      clueId: schema.clues.id,
      answer: schema.clues.answer,
      kind: schema.clues.kind,
      payload: schema.clues.payload,
    })
    .from(schema.rounds)
    .innerJoin(
      schema.categories,
      eq(schema.categories.roundId, schema.rounds.id),
    )
    .innerJoin(schema.clues, eq(schema.clues.categoryId, schema.categories.id))
    .where(and(eq(schema.rounds.packId, packId), eq(schema.rounds.kind, 'final')))
    .limit(1)
  return row ?? null
}

/**
 * Opens the wager phase and seats every eligible team.
 *
 * Rows are created only for teams that actually play, so "who is still in" is
 * a fact in the database rather than a rule the UI has to remember.
 */
export async function startFinal(code: string) {
  const game = await loadGame(code)

  const teams = await db()
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.gameId, game.id))
    .orderBy(asc(schema.teams.seat))

  const eligible = teams.filter((t) => playsFinal(t.score))
  if (eligible.length === 0) {
    throw new Error('Ingen lag har poeng over null — ingen final å spille')
  }

  await db()
    .insert(schema.finalBets)
    .values(eligible.map((t) => ({ gameId: game.id, teamId: t.id, wager: 0 })))
    .onConflictDoNothing()

  await db()
    .update(schema.games)
    .set({ phase: 'final_wager', activeClueId: null })
    .where(eq(schema.games.id, game.id))

  notifyChanged(game.id)
  return {
    eligible: eligible.map((t) => ({ id: t.id, name: t.name, score: t.score })),
    eliminated: teams
      .filter((t) => !playsFinal(t.score))
      .map((t) => ({ id: t.id, name: t.name, score: t.score })),
  }
}

/** A team commits its wager, blind. Clamped server-side to 0..own score. */
export async function lockFinalWager(joinToken: string, wager: number) {
  const [team] = await db()
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.joinToken, joinToken))
  if (!team) throw new Error('Ukjent lag')

  const [bet] = await db()
    .select()
    .from(schema.finalBets)
    .where(
      and(
        eq(schema.finalBets.gameId, team.gameId),
        eq(schema.finalBets.teamId, team.id),
      ),
    )
  if (!bet) throw new Error('Laget spiller ikke finalen')
  if (bet.wagerLockedAt) throw new Error('Innsatsen er allerede låst')

  const clamped = clampWager(wager, maxFinalWager(team.score))

  await db()
    .update(schema.finalBets)
    .set({ wager: clamped, wagerLockedAt: new Date() })
    .where(eq(schema.finalBets.id, bet.id))

  notifyChanged(team.gameId)
  return { wager: clamped, max: maxFinalWager(team.score) }
}

/** A team commits its written answer. */
export async function lockFinalAnswer(joinToken: string, answer: string) {
  const [team] = await db()
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.joinToken, joinToken))
  if (!team) throw new Error('Ukjent lag')

  const [bet] = await db()
    .select()
    .from(schema.finalBets)
    .where(
      and(
        eq(schema.finalBets.gameId, team.gameId),
        eq(schema.finalBets.teamId, team.id),
      ),
    )
  if (!bet) throw new Error('Laget spiller ikke finalen')
  if (bet.lockedAt) throw new Error('Svaret er allerede låst')

  await db()
    .update(schema.finalBets)
    .set({ answer: answer.slice(0, 300), lockedAt: new Date() })
    .where(eq(schema.finalBets.id, bet.id))

  notifyChanged(team.gameId)
  return { locked: true }
}

/** Reveals the clue and starts the 60s clock. Wagers are sealed by now. */
export async function revealFinalClue(code: string) {
  const game = await loadGame(code)

  const bets = await db()
    .select()
    .from(schema.finalBets)
    .where(eq(schema.finalBets.gameId, game.id))

  const unlocked = bets.filter((b) => !b.wagerLockedAt).length
  if (unlocked > 0) {
    // The host can still force it — a phone that never locks must not be able
    // to hold the whole room hostage.
    console.warn(`[final] revealing with ${unlocked} wager(s) unlocked`)
  }

  await db()
    .update(schema.games)
    .set({ phase: 'final_clue' })
    .where(eq(schema.games.id, game.id))

  notifyChanged(game.id)
  return { revealedAt: new Date().toISOString(), unlockedWagers: unlocked }
}

/** Stops accepting answers and shows them. Nothing is scored yet. */
export async function openFinalReveal(code: string) {
  const game = await loadGame(code)
  await db()
    .update(schema.games)
    .set({ phase: 'final_reveal' })
    .where(eq(schema.games.id, game.id))
  notifyChanged(game.id)
  return { phase: 'final_reveal' }
}

/**
 * Judges one team. The score moves through the same append-only event log as
 * everything else, so the Final is undoable exactly like a normal clue.
 */
export async function judgeFinal(
  code: string,
  teamId: string,
  correct: boolean,
) {
  const game = await loadGame(code)

  const [bet] = await db()
    .select()
    .from(schema.finalBets)
    .where(
      and(
        eq(schema.finalBets.gameId, game.id),
        eq(schema.finalBets.teamId, teamId),
      ),
    )
  if (!bet) throw new Error('Laget spiller ikke finalen')
  if (bet.verdict) throw new Error('Laget er allerede dømt')

  await db()
    .update(schema.finalBets)
    .set({ verdict: correct ? 'correct' : 'wrong' })
    .where(eq(schema.finalBets.id, bet.id))

  const result = await applyScore({
    gameId: game.id,
    teamId,
    delta: correct ? bet.wager : -bet.wager,
    kind: 'final',
    note: correct ? 'final_correct' : 'final_wrong',
  })

  notifyChanged(game.id)
  return {
    teamId,
    correct,
    delta: correct ? bet.wager : -bet.wager,
    score: result.score,
  }
}

export async function finishFinal(code: string) {
  const game = await loadGame(code)
  await db()
    .update(schema.games)
    .set({ phase: 'final_done' })
    .where(eq(schema.games.id, game.id))
  notifyChanged(game.id)
  return { phase: 'final_done' }
}

/**
 * Final state for the board and the host.
 *
 * `includeAnswers` is the whole privacy rule in one flag: written answers stay
 * sealed until the reveal, so nobody can read the room off the TV while still
 * deciding what to write.
 */
export async function finalState(code: string, includeAnswers: boolean) {
  const game = await loadGame(code)

  const rows = await db()
    .select({
      teamId: schema.finalBets.teamId,
      teamName: schema.teams.name,
      score: schema.teams.score,
      seat: schema.teams.seat,
      wager: schema.finalBets.wager,
      wagerLocked: schema.finalBets.wagerLockedAt,
      answer: schema.finalBets.answer,
      answerLocked: schema.finalBets.lockedAt,
      verdict: schema.finalBets.verdict,
    })
    .from(schema.finalBets)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.finalBets.teamId))
    .where(eq(schema.finalBets.gameId, game.id))
    .orderBy(asc(schema.teams.seat))

  const revealing =
    game.phase === 'final_reveal' || game.phase === 'final_done'

  const clue =
    game.phase === 'final_clue' || revealing
      ? await finalClue(game.packId)
      : null

  return {
    phase: game.phase,
    // Sealed during the wager phase; the prompt is not fetched at all then.
    prompt: clue?.payload.prompt ?? null,
    // The answer key is for the host, never the board.
    answerKey: includeAnswers ? (clue?.answer ?? null) : null,
    bets: rows.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      score: r.score,
      wagerLocked: Boolean(r.wagerLocked),
      answerLocked: Boolean(r.answerLocked),
      verdict: r.verdict,
      // Wagers and answers stay hidden until everyone has committed.
      wager: revealing || includeAnswers ? r.wager : null,
      answer: revealing || includeAnswers ? r.answer : null,
    })),
  }
}
