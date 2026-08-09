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
  /** Sips to attempt this tile, shown before it is picked. Never enforced. */
  sips: number
  /** Spent tiles are greyed out and cannot be picked again. */
  spent: boolean
  /**
   * Whether /api/media/:id/image will answer. The board uses it to warm every
   * image in the round while the grid is on screen, so a full-bleed photo is
   * already local when its tile opens rather than downloading in front of the
   * room. It reveals only that a tile is a picture question, which the category
   * heading ("Zoomet inn") announces anyway.
   */
  hasImage: boolean
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
  /** Needed to join the right socket room. */
  gameId: string
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
    /**
     * ISO instant the countdown runs out, or null when untimed. An absolute
     * instant rather than seconds remaining, so the board animates smoothly
     * between polls and a reload resumes the same countdown.
     */
    phaseEndsAt: string | null
    ownerTeamId: string | null
    kind: string
    prompt: string
    /** Whether this clue has bytes at /api/media/:id/image. */
    hasImage: boolean
    /** Sips to attempt this tier, from the pack's drinkScale. */
    sips: number
    /**
     * Who won the buzz race and by how much. The margin is shown on the TV
     * deliberately — it is what stops the argument before it starts.
     */
    stealWinner: { teamName: string; marginMs: number } | null
  } | null
}
