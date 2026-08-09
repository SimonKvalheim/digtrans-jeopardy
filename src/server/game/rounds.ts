import { and, asc, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { closeSteal } from './buzz.ts'
import { notifyChanged } from '../ws/hub.ts'

/**
 * Moving between rounds (PRD §2.4).
 *
 * `games.activeRoundId` was set once when the game was created and never again,
 * which made Double Jeopardy unreachable: every tile in the pack had a
 * game_clues row waiting for it, and no way to ever put it on screen.
 *
 * The show's rule comes with it — the **lowest-scoring** team picks first in
 * round 2 — and it applies on the way forward only, so that a host jumping back
 * to fix something does not also have the turn reassigned under him.
 */

const SPENT = sql`in ('revealed', 'done')`

export interface RoundProgress {
  id: string
  kind: 'jeopardy' | 'double' | 'final'
  position: number
  valueStep: number
  /** Tiles this game has for the round, and how many are already played. */
  tiles: number
  spent: number
  active: boolean
}

async function loadGame(code: string) {
  const [game] = await db()
    .select()
    .from(schema.games)
    .where(eq(schema.games.code, code.toUpperCase()))
  if (!game) throw new Error('Fant ikke spillet')
  return game
}

/**
 * Moves the board between the lobby and the grid.
 *
 * The lobby is a screen, not a stage of a state machine: the host puts the
 * room code and its QR back up whenever a late team needs to join, and takes it
 * down when play resumes. Refusing to go backwards would mean a team arriving
 * at 21:40 has nothing to scan.
 */
export async function setLobby(code: string, open: boolean) {
  const game = await loadGame(code)
  if (game.phase.startsWith('final')) {
    throw new Error('Finalen er i gang — lobbyen er ikke tilgjengelig')
  }

  await db()
    .update(schema.games)
    .set({ phase: open ? 'lobby' : 'board' })
    .where(eq(schema.games.id, game.id))

  notifyChanged(game.id)
  return { phase: open ? 'lobby' : 'board' }
}

/**
 * Every round in the pack with tonight's progress against it, so the console
 * can say "runde 1 · 28 av 30 spilt" rather than making the host count tiles.
 */
export async function roundProgress(code: string): Promise<RoundProgress[]> {
  const game = await loadGame(code)

  const rows = await db()
    .select({
      id: schema.rounds.id,
      kind: schema.rounds.kind,
      position: schema.rounds.position,
      valueStep: schema.rounds.valueStep,
      tiles: sql<number>`cast(count(${schema.gameClues.id}) as int)`,
      spent: sql<number>`cast(count(*) filter (where ${schema.gameClues.phase} ${SPENT}) as int)`,
    })
    .from(schema.rounds)
    // Left all the way down: a round with no categories yet still has to appear
    // in this list, or the console silently loses a round.
    .leftJoin(
      schema.categories,
      eq(schema.categories.roundId, schema.rounds.id),
    )
    .leftJoin(schema.clues, eq(schema.clues.categoryId, schema.categories.id))
    .leftJoin(
      schema.gameClues,
      and(
        eq(schema.gameClues.clueId, schema.clues.id),
        eq(schema.gameClues.gameId, game.id),
      ),
    )
    .where(eq(schema.rounds.packId, game.packId))
    .groupBy(schema.rounds.id)
    .orderBy(asc(schema.rounds.position))

  return rows.map((r) => ({ ...r, active: r.id === game.activeRoundId }))
}

/**
 * Puts a round on the board.
 *
 * With no `roundId` this advances to the next playable round, which is the
 * button the host presses once all evening. With one, it jumps to that round —
 * the manual override that keeps the console self-sufficient.
 */
export async function setRound(code: string, roundId?: string) {
  const game = await loadGame(code)
  const rounds = await roundProgress(code)
  const playable = rounds.filter((r) => r.kind !== 'final')

  const current = rounds.find((r) => r.id === game.activeRoundId)

  let target: RoundProgress | undefined
  if (roundId) {
    target = playable.find((r) => r.id === roundId)
    if (!target) throw new Error('Ukjent runde')
  } else {
    const index = playable.findIndex((r) => r.id === game.activeRoundId)
    target = playable[index + 1]
    if (!target) {
      throw new Error('Ingen flere runder — start finalen fra Final-fanen')
    }
  }

  // "Lowest scorer picks first" is a rule about progressing into the next
  // round, not about the host correcting a mistake, so it fires on the way
  // forward only. Ties break on seat, which is stable and visible on the TV.
  const advancing = (current?.position ?? -1) < target.position
  let turnTeamId = game.turnTeamId

  if (advancing) {
    const [lowest] = await db()
      .select({ id: schema.teams.id, name: schema.teams.name })
      .from(schema.teams)
      .where(eq(schema.teams.gameId, game.id))
      .orderBy(asc(schema.teams.score), asc(schema.teams.seat))
      .limit(1)
    if (lowest) turnTeamId = lowest.id
  }

  // A tile that was still on screen when the round changed has to be retired,
  // not merely dropped. Clearing activeClueId alone would leave it in
  // clue_open forever: it would read as unplayed on the board and then refuse
  // to open, because openClue only accepts a tile in `closed`.
  if (game.activeClueId) {
    await db()
      .update(schema.gameClues)
      .set({ phase: 'done', phaseEndsAt: null })
      .where(eq(schema.gameClues.id, game.activeClueId))
  }

  await db()
    .update(schema.games)
    .set({
      activeRoundId: target.id,
      // Whatever was open belonged to the round being left.
      activeClueId: null,
      phase: 'board',
      turnTeamId,
    })
    .where(eq(schema.games.id, game.id))

  closeSteal(game.id)
  notifyChanged(game.id)

  const [turnTeam] = turnTeamId
    ? await db()
        .select({ name: schema.teams.name })
        .from(schema.teams)
        .where(eq(schema.teams.id, turnTeamId))
    : []

  return {
    roundId: target.id,
    kind: target.kind,
    position: target.position,
    turnTeamId,
    turnTeamName: turnTeam?.name ?? null,
    /** True when the show's round-2 rule was the thing that set the turn. */
    lowestScorerPicks: advancing,
  }
}
