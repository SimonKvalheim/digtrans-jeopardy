import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { CluePayload } from '../../shared/clue-kinds.ts'

/**
 * Two halves, deliberately not one (PRD §6.1).
 *
 *   packs → rounds → categories → clues → clue_media   content, replayed forever
 *   games → teams / game_clues → buzzes …              one night of playing it
 *
 * The moment a clue row carries "has this been answered", the content becomes
 * single-use and the app cannot be reused for the next event. All per-night
 * mutation therefore lives in game_clues.
 */

const bytea = customType<{ data: Buffer; notNull: false }>({
  dataType: () => 'bytea',
})

export const roundKind = pgEnum('round_kind', ['jeopardy', 'double', 'final'])

export const cluePhase = pgEnum('clue_phase', [
  'closed',
  'dd_wager',
  'dd_answer',
  'clue_open',
  'steal_open',
  'steal_answer',
  'revealed',
  'done',
])

// ─── CONTENT: write once, replay forever ─────────────────────────────────────

export const packs = pgTable('packs', {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  locale: text().notNull().default('nb'),
  /** Sips per tier, indexed by `tier - 1`. See sipsForTier in scoring.ts. */
  drinkScale: jsonb().$type<number[]>().notNull(),
  publishedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const rounds = pgTable(
  'rounds',
  {
    id: uuid().primaryKey().defaultRandom(),
    packId: uuid()
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    kind: roundKind().notNull(),
    position: integer().notNull(),
    /** A clue is worth `tier × valueStep`. 100 in round 1, 200 in round 2. */
    valueStep: integer().notNull(),
    dailyDoubles: integer().notNull(),
  },
  (t) => [unique().on(t.packId, t.position)],
)

export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    roundId: uuid()
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** Set for paired categories, e.g. "Musikk" / "Kunstverk". */
    pairedWith: text(),
    position: integer().notNull(),
  },
  (t) => [unique().on(t.roundId, t.position)],
)

export const clues = pgTable(
  'clues',
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** 1..5. Drives points AND sips — never store a raw point value here. */
    tier: integer().notNull(),
    answer: text().notNull(),
    /** Which half of a paired category this clue came from. */
    fromLabel: text(),
    /** Derived from payload.kind on import so the two cannot drift. */
    kind: text().notNull(),
    payload: jsonb().$type<CluePayload>().notNull(),
  },
  (t) => [unique().on(t.categoryId, t.tier)],
)

export const clueMedia = pgTable('clue_media', {
  clueId: uuid()
    .primaryKey()
    .references(() => clues.id, { onDelete: 'cascade' }),
  imageBytes: bytea(),
  imageMime: text(),
  /** Pre-generated at publish; never synthesised live. See PRD §8.2. */
  ttsBytes: bytea(),
  ttsVoiceId: text(),
  ttsBuiltAt: timestamp({ withTimezone: true }),
})

// ─── PLAY: everything that mutates tonight ───────────────────────────────────

export const games = pgTable('games', {
  id: uuid().primaryKey().defaultRandom(),
  packId: uuid()
    .notNull()
    .references(() => packs.id),
  /** Room code shown on the TV, e.g. "NTNU". */
  code: text().notNull().unique(),
  phase: text().notNull().default('lobby'),
  activeRoundId: uuid(),
  /** → game_clues.id, not clues.id. */
  activeClueId: uuid(),
  turnTeamId: uuid(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const teams = pgTable(
  'teams',
  {
    id: uuid().primaryKey().defaultRandom(),
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    pitch: text(),
    /** Fast read for the board; score_events is the truth behind it. */
    score: integer().notNull().default(0),
    /** Kept in localStorage. Without this the game dies twenty minutes in. */
    joinToken: text().notNull().unique(),
    seat: integer().notNull(),
  },
  (t) => [unique().on(t.gameId, t.seat)],
)

export const gameClues = pgTable(
  'game_clues',
  {
    id: uuid().primaryKey().defaultRandom(),
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    clueId: uuid()
      .notNull()
      .references(() => clues.id),
    phase: cluePhase().notNull().default('closed'),
    ownerTeamId: uuid(),
    /** Randomised per game, so nobody learns positions from a previous run. */
    isDailyDouble: boolean().notNull().default(false),
    /** Whoever won the buzz race for the single steal on this clue. */
    stealTeamId: uuid(),
    wager: integer(),
    /**
     * When the current phase's countdown runs out. Stored as an absolute
     * instant rather than a remaining duration so that a board reload — or a
     * redeploy that drops every socket — resumes the same countdown instead of
     * restarting it. Null means untimed, which is also how the host pauses.
     */
    phaseEndsAt: timestamp({ withTimezone: true, precision: 3 }),
  },
  (t) => [unique().on(t.gameId, t.clueId)],
)

export const buzzes = pgTable(
  'buzzes',
  {
    id: uuid().primaryKey().defaultRandom(),
    gameClueId: uuid()
      .notNull()
      .references(() => gameClues.id, { onDelete: 'cascade' }),
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    /** Stamped on arrival at the server. Never trust a client clock. */
    receivedAt: timestamp({ withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    /** Reserved for the clock-offset upgrade (PRD §5.1). No migration needed. */
    pressOffsetMs: integer(),
    won: boolean().notNull().default(false),
  },
  (t) => [index().on(t.gameClueId, t.receivedAt)],
)

/**
 * Append-only truth. teams.score is derived from this, which is what makes
 * "↶ Angre" free — and undo will get used on Tuesday.
 */
export const scoreEvents = pgTable(
  'score_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    clueId: uuid(),
    /** own | steal | daily_double | final | name_bonus | manual */
    kind: text().notNull(),
    delta: integer().notNull(),
    note: text(),
    undone: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.gameId, t.createdAt)],
)

export const finalBets = pgTable(
  'final_bets',
  {
    id: uuid().primaryKey().defaultRandom(),
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    /** 0..score, and only for teams with score > 0. */
    wager: integer().notNull(),
    /**
     * Set when the wager is committed — before the clue exists. The Final is
     * fully blind, so this must be separate from the answer lock or the wager
     * could be chosen with the question already on screen.
     */
    wagerLockedAt: timestamp({ withTimezone: true }),
    answer: text(),
    verdict: text(),
    lockedAt: timestamp({ withTimezone: true }),
  },
  (t) => [unique().on(t.gameId, t.teamId)],
)
