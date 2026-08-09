import { and, desc, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'

/**
 * Scoring, written so that undo is free (PRD §6.3).
 *
 * score_events is append-only truth; teams.score is a derived fast read kept in
 * step inside the same transaction. Undo therefore never deletes anything — it
 * flags an event as undone and reverses its delta. That matters because undo
 * will get used on Tuesday, probably in a hurry, probably more than once.
 */

export type ScoreKind =
  | 'own'
  | 'steal'
  | 'daily_double'
  | 'final'
  | 'name_bonus'
  | 'manual'

export interface ApplyScoreOptions {
  gameId: string
  teamId: string
  delta: number
  kind: ScoreKind
  clueId?: string | null
  note?: string | null
}

export async function applyScore(options: ApplyScoreOptions) {
  const { gameId, teamId, delta, kind, clueId = null, note = null } = options

  return db().transaction(async (tx) => {
    const [event] = await tx
      .insert(schema.scoreEvents)
      .values({ gameId, teamId, clueId, kind, delta, note })
      .returning()

    const [team] = await tx
      .update(schema.teams)
      .set({ score: sql`${schema.teams.score} + ${delta}` })
      .where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId)))
      .returning({ id: schema.teams.id, score: schema.teams.score })

    if (!team) throw new Error('Fant ikke laget i dette spillet')

    return { eventId: event!.id, teamId: team.id, score: team.score }
  })
}

/**
 * Reverses the most recent event that has not already been undone. Scoped to
 * the game, and optionally to one team when the host knows exactly which row
 * was wrong.
 */
export async function undoLastScore(gameId: string, teamId?: string) {
  return db().transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(schema.scoreEvents)
      .where(
        teamId
          ? and(
              eq(schema.scoreEvents.gameId, gameId),
              eq(schema.scoreEvents.teamId, teamId),
              eq(schema.scoreEvents.undone, false),
            )
          : and(
              eq(schema.scoreEvents.gameId, gameId),
              eq(schema.scoreEvents.undone, false),
            ),
      )
      .orderBy(desc(schema.scoreEvents.createdAt))
      .limit(1)

    if (!event) return null

    await tx
      .update(schema.scoreEvents)
      .set({ undone: true })
      .where(eq(schema.scoreEvents.id, event.id))

    const [team] = await tx
      .update(schema.teams)
      .set({ score: sql`${schema.teams.score} - ${event.delta}` })
      .where(eq(schema.teams.id, event.teamId))
      .returning({ id: schema.teams.id, score: schema.teams.score })

    return {
      undoneEventId: event.id,
      teamId: event.teamId,
      reversed: event.delta,
      score: team?.score ?? 0,
    }
  })
}

/**
 * Recomputes every score from the event log. Not used in the normal path — it
 * exists because the derived column is only ever as trustworthy as the last
 * transaction, and being able to rebuild the truth beats arguing about it.
 */
export async function recomputeScores(gameId: string) {
  return db().transaction(async (tx) => {
    const teams = await tx
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.gameId, gameId))

    const results: { teamId: string; score: number }[] = []

    for (const team of teams) {
      const [row] = await tx
        .select({
          total: sql<number>`coalesce(sum(${schema.scoreEvents.delta}), 0)::int`,
        })
        .from(schema.scoreEvents)
        .where(
          and(
            eq(schema.scoreEvents.teamId, team.id),
            eq(schema.scoreEvents.undone, false),
          ),
        )

      const total = row?.total ?? 0
      await tx
        .update(schema.teams)
        .set({ score: total })
        .where(eq(schema.teams.id, team.id))

      results.push({ teamId: team.id, score: total })
    }

    return results
  })
}
