import { and, asc, eq } from 'drizzle-orm'
import type {
  BoardCategory,
  BoardState,
  BoardTeam,
} from '../../shared/board-state.ts'
import { sipsForTier, valueForTier } from '../../shared/scoring.ts'
import type { Tier } from '../../shared/pack-schema.ts'
import { db, schema } from '../db/index.ts'

/** A tile is spent once its clue has been resolved one way or another. */
const SPENT_PHASES = new Set(['revealed', 'done'])

/**
 * Assembles everything the TV draws. Deliberately excludes clue prompts and
 * answers: the board is a borrowed laptop and the least trusted device in the
 * room, so it is told what tiles exist, not what is behind them.
 */
export async function buildBoardState(code: string): Promise<BoardState | null> {
  const database = db()

  const [game] = await database
    .select()
    .from(schema.games)
    .where(eq(schema.games.code, code.toUpperCase()))

  if (!game) return null

  const [pack] = await database
    .select({ drinkScale: schema.packs.drinkScale })
    .from(schema.packs)
    .where(eq(schema.packs.id, game.packId))

  const teams: BoardTeam[] = await database
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      score: schema.teams.score,
      seat: schema.teams.seat,
    })
    .from(schema.teams)
    .where(eq(schema.teams.gameId, game.id))
    .orderBy(asc(schema.teams.seat))

  let round: BoardState['round'] = null

  if (game.activeRoundId) {
    const [activeRound] = await database
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.id, game.activeRoundId))

    if (activeRound) {
      const rows = await database
        .select({
          categoryId: schema.categories.id,
          categoryName: schema.categories.name,
          pairedWith: schema.categories.pairedWith,
          categoryPosition: schema.categories.position,
          tier: schema.clues.tier,
          gameClueId: schema.gameClues.id,
          phase: schema.gameClues.phase,
        })
        .from(schema.categories)
        .innerJoin(
          schema.clues,
          eq(schema.clues.categoryId, schema.categories.id),
        )
        .innerJoin(
          schema.gameClues,
          and(
            eq(schema.gameClues.clueId, schema.clues.id),
            // Without this the join fans out across every game that has ever
            // played this pack, and each tile appears once per game.
            eq(schema.gameClues.gameId, game.id),
          ),
        )
        .where(eq(schema.categories.roundId, activeRound.id))
        .orderBy(asc(schema.categories.position), asc(schema.clues.tier))

      const byCategory = new Map<string, BoardCategory>()

      for (const row of rows) {
        let category = byCategory.get(row.categoryId)
        if (!category) {
          category = {
            id: row.categoryId,
            name: row.categoryName,
            pairedWith: row.pairedWith,
            tiles: [],
          }
          byCategory.set(row.categoryId, category)
        }
        category.tiles.push({
          id: row.gameClueId,
          tier: row.tier,
          value: valueForTier(row.tier as Tier, activeRound.valueStep),
          spent: SPENT_PHASES.has(row.phase),
        })
      }

      round = {
        id: activeRound.id,
        kind: activeRound.kind,
        valueStep: activeRound.valueStep,
        categories: [...byCategory.values()],
      }
    }
  }

  const drinkScale = pack?.drinkScale ?? []

  return {
    code: game.code,
    phase: game.phase,
    round,
    teams,
    turnTeamId: game.turnTeamId,
    drinkScale,
    activeClue: await buildActiveClue(game.activeClueId, drinkScale),
  }
}

/**
 * The open tile as the TV should see it: the prompt, never the answer. The
 * answer lives only behind the host PIN.
 */
async function buildActiveClue(
  activeClueId: string | null,
  drinkScale: readonly number[],
): Promise<BoardState['activeClue']> {
  if (!activeClueId) return null

  const [row] = await db()
    .select({
      id: schema.gameClues.id,
      phase: schema.gameClues.phase,
      ownerTeamId: schema.gameClues.ownerTeamId,
      isDailyDouble: schema.gameClues.isDailyDouble,
      tier: schema.clues.tier,
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
    .where(eq(schema.gameClues.id, activeClueId))

  if (!row) return null

  return {
    id: row.id,
    phase: row.phase,
    categoryName: row.categoryName,
    fromLabel: row.fromLabel,
    tier: row.tier,
    value: valueForTier(row.tier as Tier, row.valueStep),
    isDailyDouble: row.isDailyDouble,
    ownerTeamId: row.ownerTeamId,
    kind: row.kind,
    prompt: row.payload.prompt,
    sips: sipsForTier(row.tier as Tier, drinkScale),
  }
}
