import { and, asc, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'

/**
 * The buzz race (PRD §5.1).
 *
 * The winner is decided by a **synchronous** check-and-set with no await
 * between the two halves. Node runs one tick at a time, so two buzzes cannot
 * both see an empty slot — a double-award is structurally impossible rather
 * than merely unlikely. Everything after that (recording the buzz, moving the
 * clue's phase) is persistence, and cannot change who won.
 *
 * Ranking is server arrival order, deliberately. `buzzes.pressOffsetMs` exists
 * for the clock-offset upgrade if the dry run shows the spread is too wide; the
 * column is already there so that change needs no migration.
 */

interface OpenSteal {
  gameClueId: string
  /** Set the instant the first buzz is accepted. */
  winnerTeamId?: string
  winnerAt?: number
  /** teamId → arrival time, for reporting the margin. */
  arrivals: Map<string, number>
}

const openSteals = new Map<string, OpenSteal>()

/** Called when a clue enters steal_open. Resets any previous race. */
export function openSteal(gameId: string, gameClueId: string) {
  openSteals.set(gameId, { gameClueId, arrivals: new Map() })
}

/** Called when the window closes for any reason. */
export function closeSteal(gameId: string) {
  openSteals.delete(gameId)
}

export interface BuzzResult {
  won: boolean
  gameClueId: string
  teamId: string
  receivedAt: number
  /** Milliseconds behind the winner. Zero for the winner itself. */
  marginMs: number
}

/**
 * Decides the race. Everything up to the return is synchronous on purpose —
 * do not add an await inside this function.
 */
export function tryBuzz(gameId: string, teamId: string): BuzzResult | null {
  const receivedAt = Date.now()
  const steal = openSteals.get(gameId)

  // No open window, or this team already buzzed.
  if (!steal) return null
  if (steal.arrivals.has(teamId)) return null

  steal.arrivals.set(teamId, receivedAt)

  // ── the atomic bit: no await between the test and the assignment ──
  const won = steal.winnerTeamId === undefined
  if (won) {
    steal.winnerTeamId = teamId
    steal.winnerAt = receivedAt
  }
  // ──────────────────────────────────────────────────────────────────

  return {
    won,
    gameClueId: steal.gameClueId,
    teamId,
    receivedAt,
    marginMs: won ? 0 : receivedAt - (steal.winnerAt ?? receivedAt),
  }
}

/**
 * Persists a decided buzz. Runs after the race is already settled, so a slow
 * database can delay the record but never change the outcome.
 *
 * The phase update is still guarded on `steal_open`, so even if the in-memory
 * gate were lost to a redeploy mid-window, two winners could not be written.
 */
export async function recordBuzz(result: BuzzResult) {
  await db()
    .insert(schema.buzzes)
    .values({
      gameClueId: result.gameClueId,
      teamId: result.teamId,
      receivedAt: new Date(result.receivedAt),
      won: result.won,
    })

  if (!result.won) return

  await db()
    .update(schema.gameClues)
    .set({
      phase: 'steal_answer',
      stealTeamId: result.teamId,
      // The stealing team now answers; the countdown was for buzzing in.
      phaseEndsAt: null,
    })
    .where(
      and(
        eq(schema.gameClues.id, result.gameClueId),
        eq(schema.gameClues.phase, 'steal_open'),
      ),
    )
}

/** The race as recorded, so the board can show the margin and nobody argues. */
export async function buzzOrder(gameClueId: string) {
  const rows = await db()
    .select({
      teamId: schema.buzzes.teamId,
      receivedAt: schema.buzzes.receivedAt,
      won: schema.buzzes.won,
      teamName: schema.teams.name,
    })
    .from(schema.buzzes)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.buzzes.teamId))
    .where(eq(schema.buzzes.gameClueId, gameClueId))
    .orderBy(asc(schema.buzzes.receivedAt))

  const first = rows[0]?.receivedAt.getTime()

  return rows.map((r) => ({
    teamId: r.teamId,
    teamName: r.teamName,
    won: r.won,
    marginMs: first ? r.receivedAt.getTime() - first : 0,
  }))
}
