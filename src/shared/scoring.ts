import type { Tier } from './pack-schema.ts'

/**
 * Every points and sips calculation in the game, as pure functions (PRD §4.2).
 *
 * This is the one module with a test, because it is the one place where a
 * silent bug ruins the evening: nobody notices a wrong penalty until the
 * standings are already wrong.
 */

/** A clue is worth tier × the round's step. No raw value is ever stored. */
export function valueForTier(tier: Tier, valueStep: number): number {
  return tier * valueStep
}

/**
 * Sips are indexed by `tier - 1`, so drinkScale [2,4,6,8,10] means tier 1 costs
 * 2 sips. Tier is 1-based and the array is not — this helper exists so that
 * off-by-one is written down exactly once.
 */
export function sipsForTier(tier: Tier, drinkScale: readonly number[]): number {
  return drinkScale[tier - 1] ?? 0
}

export type Outcome =
  | { kind: 'own'; correct: boolean }
  | { kind: 'steal'; correct: boolean }
  | { kind: 'timeout' }
  | { kind: 'no_steal' }
  | { kind: 'daily_double'; correct: boolean; wager: number }
  | { kind: 'final'; correct: boolean; wager: number }

/**
 * The score change for one outcome. Positive adds, negative subtracts.
 *
 * The asymmetry is deliberate: the owner answered blind so a miss costs half,
 * while a stealing team had already heard a wrong answer and pays full.
 */
export function scoreDelta(outcome: Outcome, value: number): number {
  switch (outcome.kind) {
    case 'own':
      return outcome.correct ? value : -halve(value)
    case 'timeout':
      // Timing out is treated exactly as an owner miss.
      return -halve(value)
    case 'steal':
      return outcome.correct ? value : -value
    case 'no_steal':
      // Triple stumper. Nobody loses points; the room drinks instead.
      return 0
    case 'daily_double':
    case 'final':
      return outcome.correct ? outcome.wager : -outcome.wager
  }
}

/** Half, rounded down, so an odd value never costs the extra point. */
function halve(value: number): number {
  return Math.floor(value / 2)
}

/**
 * Daily Doubles keep the classic floor: a team at or below zero may still
 * wager up to the round's top clue value, because otherwise the tile is dead
 * and the board stalls mid-round.
 */
export function maxDailyDoubleWager(score: number, valueStep: number): number {
  return Math.max(score, 5 * valueStep)
}

/**
 * The Final is different on purpose: a team at or below zero does not play at
 * all, so there is no wager to cap (PRD §4.3).
 */
export function maxFinalWager(score: number): number {
  return Math.max(0, score)
}

export function playsFinal(score: number): boolean {
  return score > 0
}

/** Clamp a submitted wager into the legal range, never trusting the client. */
export function clampWager(wager: number, max: number): number {
  if (!Number.isFinite(wager)) return 0
  return Math.min(Math.max(0, Math.floor(wager)), max)
}
