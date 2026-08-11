/**
 * What the TV needs to draw itself, and nothing more.
 *
 * The board never receives clue text or answers for tiles it has not opened — a
 * laptop plugged into a TV is the least trusted device in the room, and the
 * whole point of /host being PIN-gated is undone if the answers ride along in
 * every board payload. Even the open clue's answer is withheld until its phase
 * is terminal; see `activeClue.answer`.
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
  /**
   * Whether this tile also has a reveal picture. Warmed alongside the question
   * image: the reveal lands seconds after the tile opens, which is far too late
   * to start a download in front of the room.
   */
  hasRevealImage: boolean
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
  /** Which big-screen view the host has chosen for the TV. */
  screen: 'studio' | 'plain'
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
   * The tile currently open, if any. Carries the prompt, and the answer only
   * once the clue is over — while it is still live the TV shows the question
   * and the host console shows the key.
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
    /**
     * Whether there is a whole picture at /api/media/:id/reveal. Safe to send
     * before the reveal: it says a fuller picture exists, which the crop
     * already implies, and never what it is of.
     */
    hasRevealImage: boolean
    /** Sips to attempt this tier, from the pack's drinkScale. */
    sips: number
    /**
     * Who won the buzz race and by how much. The margin is shown on the TV
     * deliberately — it is what stops the argument before it starts.
     */
    stealWinner: { teamName: string; marginMs: number } | null
    /**
     * The correct answer — but only once the clue is terminal (`revealed` or
     * `done`). Null in every other phase, and decided on the server rather
     * than merely hidden by the board: /api/board/:code is unauthenticated by
     * design, so an answer that reaches this payload early is an answer a team
     * can curl while they are still supposed to be guessing.
     */
    answer: string | null
  } | null
}
