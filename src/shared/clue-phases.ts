/**
 * Where a clue is in its per-night life (PRD §4.1) — an axis entirely separate
 * from what kind of clue it is, which is why this is not in clue-kinds.ts.
 */

/**
 * Phases in which the answer is already public to the room: `revealed` is
 * nobody getting it, `done` is somebody getting it. The tile stays on screen
 * through both until the host closes it.
 *
 * This lives in shared rather than in the client because the server uses it to
 * decide whether the answer may enter the board payload at all. Two copies of
 * "which phases are terminal" would be a copy that can drift into a leak.
 */
export const ANSWER_OUT_PHASES = ['revealed', 'done'] as const

/**
 * Takes a bare string rather than the phase union on purpose: every caller's
 * input arrives via BoardState, which widens `phase` to string at the wire
 * boundary. An unrecognised phase returns false — a tile that looks unspent,
 * never an answer shown early.
 */
export function isAnswerOut(phase: string): boolean {
  return (ANSWER_OUT_PHASES as readonly string[]).includes(phase)
}
