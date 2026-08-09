import { randomInt, randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'

/**
 * Starting one night of play from a published pack (PRD §6.1).
 *
 * The pack is untouched. Everything that mutates tonight goes into game_clues,
 * which is what lets the same pack be replayed — and what makes Daily Double
 * positions genuinely random per game instead of learnable from a previous run.
 */

// No vowels (no accidental words) and no 0/O/1/I (misread across a room).
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789'

function generateCode(length = 4): string {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

/** Fisher–Yates, using crypto randomness rather than Math.random. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export interface CreateGameOptions {
  packSlug: string
  /** Supply one to keep a memorable code; otherwise a safe one is generated. */
  code?: string
}

export async function createGame({ packSlug, code }: CreateGameOptions) {
  return db().transaction(async (tx) => {
    const [pack] = await tx
      .select()
      .from(schema.packs)
      .where(eq(schema.packs.slug, packSlug))

    if (!pack) throw new Error(`Fant ingen pakke med slug "${packSlug}"`)
    if (!pack.publishedAt) {
      throw new Error(`Pakken "${packSlug}" er ikke publisert`)
    }

    const packRounds = await tx
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.packId, pack.id))
      .orderBy(asc(schema.rounds.position))

    const firstPlayable = packRounds.find((r) => r.kind !== 'final')
    if (!firstPlayable) throw new Error('Pakken har ingen spillbare runder')

    const [game] = await tx
      .insert(schema.games)
      .values({
        packId: pack.id,
        code: code?.toUpperCase() ?? generateCode(),
        phase: 'lobby',
        activeRoundId: firstPlayable.id,
      })
      .returning()

    // One game_clues row per clue in the pack, so every tile has somewhere to
    // record tonight's phase without touching the content tables.
    let dailyDoubleCount = 0

    for (const round of packRounds) {
      const roundCategories = await tx
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.roundId, round.id))

      const clueIds: string[] = []
      for (const category of roundCategories) {
        const rows = await tx
          .select({ id: schema.clues.id })
          .from(schema.clues)
          .where(eq(schema.clues.categoryId, category.id))
        clueIds.push(...rows.map((r) => r.id))
      }

      if (clueIds.length === 0) continue

      // Drawn fresh every game. This is the whole reason content and play are
      // separate tables.
      const doubles = new Set(
        round.kind === 'final'
          ? []
          : shuffle(clueIds).slice(0, round.dailyDoubles),
      )
      dailyDoubleCount += doubles.size

      await tx.insert(schema.gameClues).values(
        clueIds.map((clueId) => ({
          id: randomUUID(),
          gameId: game!.id,
          clueId,
          isDailyDouble: doubles.has(clueId),
        })),
      )
    }

    return {
      gameId: game!.id,
      code: game!.code,
      packSlug,
      dailyDoubles: dailyDoubleCount,
    }
  })
}
