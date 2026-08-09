/**
 * What the TV needs to draw itself, and nothing more.
 *
 * The board never receives clue text or answers for unopened tiles — a laptop
 * plugged into a TV is the least trusted device in the room, and the whole
 * point of /host being PIN-gated is undone if the answers ride along in every
 * board payload.
 */

export interface BoardTile {
  /** game_clues.id — the per-night row, not the content row. */
  id: string
  tier: number
  /** tier × the round's valueStep, precomputed so the board never does maths. */
  value: number
  /** Spent tiles are greyed out and cannot be picked again. */
  spent: boolean
}

export interface BoardCategory {
  id: string
  name: string
  pairedWith: string | null
  tiles: BoardTile[]
}

export interface BoardTeam {
  id: string
  name: string
  score: number
  seat: number
}

export interface BoardState {
  code: string
  phase: string
  round: {
    id: string
    kind: 'jeopardy' | 'double' | 'final'
    valueStep: number
    categories: BoardCategory[]
  } | null
  teams: BoardTeam[]
  /** Whose turn it is to pick, or null in the lobby. */
  turnTeamId: string | null
  /** Sips per tier, indexed by tier - 1. Displayed, never tracked. */
  drinkScale: number[]
  /**
   * The tile currently open, if any. Carries the prompt but deliberately not
   * the answer — the TV shows the question, the host console shows the key.
   */
  activeClue: {
    id: string
    phase: string
    categoryName: string
    fromLabel: string | null
    tier: number
    value: number
    isDailyDouble: boolean
    /** Locked Daily Double wager, once the owning team has committed to it. */
    wager: number | null
    ownerTeamId: string | null
    kind: string
    prompt: string
    /** Sips to attempt this tier, from the pack's drinkScale. */
    sips: number
  } | null
}
