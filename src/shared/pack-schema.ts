import { z } from 'zod'
import { cluePayloadSchema } from './clue-kinds.ts'

/**
 * The wire format for a clue pack (PRD §6.2).
 *
 * Content is authored as JSON, never committed, and pushed over HTTPS to the
 * PIN-gated import route. This schema is the only contract between the author
 * and the database, so it is deliberately strict: unknown keys are rejected
 * rather than silently dropped, because a typo'd field is a clue that will be
 * blank on a TV in front of thirty people.
 *
 * Import is two-phase, matching the draft/publish split:
 *   - `packSchema` validates structure. Media may still be missing.
 *   - `validateForPublish` demands everything a live board needs.
 * That lets clue text be drafted before images exist.
 */

export const TIERS = [1, 2, 3, 4, 5] as const
export type Tier = (typeof TIERS)[number]

const tierSchema = z
  .number()
  .int()
  .min(1)
  .max(5)
  .transform((n) => n as Tier)

export const imageSchema = z.strictObject({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  /** Raw base64, no `data:` prefix. */
  base64: z.string().min(1),
})

export const clueSchema = z.strictObject({
  tier: tierSchema,
  answer: z.string().min(1, 'answer kan ikke være tom').max(300),
  /** Which half of a paired category this came from, e.g. "Musikk". */
  fromLabel: z.string().max(60).optional(),
  payload: cluePayloadSchema,
  image: imageSchema.optional(),
  /**
   * Shown after the answer is out, on an image clue whose question is a crop.
   * Always optional — a clue without one reveals exactly as it does today.
   */
  revealImage: imageSchema.optional(),
})

export const categorySchema = z.strictObject({
  name: z.string().min(1).max(60),
  /** Set for paired categories, e.g. name "Musikk" pairedWith "Kunstverk". */
  pairedWith: z.string().max(60).optional(),
  clues: z
    .array(clueSchema)
    .min(1)
    .max(5)
    .refine(
      (clues) => new Set(clues.map((c) => c.tier)).size === clues.length,
      { message: 'to klør i samme kategori har samme tier' },
    ),
})

export const roundSchema = z.strictObject({
  kind: z.enum(['jeopardy', 'double', 'final']),
  /**
   * tier × valueStep is the clue's value. The Final ignores it entirely — it
   * is scored purely on the wager — so it may be omitted there. Playable
   * rounds are required to set it, checked in validateForPublish.
   */
  valueStep: z.number().int().nonnegative().default(0),
  dailyDoubles: z.number().int().min(0).max(3),
  categories: z.array(categorySchema).min(1).max(8),
})

export const packSchema = z.strictObject({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug må være små bokstaver, tall og bindestrek'),
  title: z.string().min(1).max(120),
  locale: z.string().min(2).max(10).default('nb'),
  /** Sips per tier, indexed by `tier - 1`. See sipsForTier in scoring.ts. */
  drinkScale: z.array(z.number().int().nonnegative()).length(5),
  rounds: z.array(roundSchema).min(1).max(3),
})

export type PackInput = z.infer<typeof packSchema>
export type RoundInput = z.infer<typeof roundSchema>
export type CategoryInput = z.infer<typeof categorySchema>
export type ClueInput = z.infer<typeof clueSchema>

export interface PackProblem {
  path: string
  message: string
}

/**
 * Structural rules that Zod cannot express cleanly, plus everything a board
 * needs in order to render without a hole in it. Run before publishing; a
 * draft is allowed to fail these.
 */
export function validateForPublish(pack: PackInput): PackProblem[] {
  const problems: PackProblem[] = []

  const finals = pack.rounds.filter((r) => r.kind === 'final')
  if (finals.length > 1) {
    problems.push({ path: 'rounds', message: 'mer enn én final-runde' })
  }

  const playable = pack.rounds.filter((r) => r.kind !== 'final')
  if (playable.length === 0) {
    problems.push({ path: 'rounds', message: 'ingen spillbare runder' })
  }

  for (const [ri, round] of pack.rounds.entries()) {
    const at = `rounds[${ri}]`

    if (round.kind === 'final') {
      if (round.categories.length !== 1) {
        problems.push({ path: at, message: 'final må ha nøyaktig én kategori' })
      }
      if (round.categories[0]?.clues.length !== 1) {
        problems.push({ path: at, message: 'final må ha nøyaktig én clue' })
      }
      if (round.dailyDoubles !== 0) {
        problems.push({ path: at, message: 'final kan ikke ha daily doubles' })
      }
    } else {
      if (round.valueStep <= 0) {
        problems.push({
          path: at,
          message: 'spillbar runde må ha valueStep (100 i runde 1, 200 i runde 2)',
        })
      }

      // Daily Double positions are drawn per game, so there must be at least
      // as many tiles as doubles to hide in them.
      const tileCount = round.categories.reduce(
        (n, c) => n + c.clues.length,
        0,
      )
      if (round.dailyDoubles > tileCount) {
        problems.push({
          path: at,
          message: `${round.dailyDoubles} daily doubles i en runde med ${tileCount} ruter`,
        })
      }
    }

    for (const [ci, category] of round.categories.entries()) {
      const catAt = `${at}.categories[${ci}] (${category.name})`

      for (const clue of category.clues) {
        const clueAt = `${catAt} tier ${clue.tier}`

        if (clue.payload.kind === 'image' && !clue.image) {
          problems.push({ path: clueAt, message: 'image-clue mangler bilde' })
        }
        if (clue.payload.kind !== 'image' && clue.image) {
          problems.push({
            path: clueAt,
            message: `bilde er lagt ved en ${clue.payload.kind}-clue`,
          })
        }
        // A reveal picture with nothing to reveal from would simply never be
        // reached, so it is a mistake worth naming rather than dead weight.
        if (clue.payload.kind !== 'image' && clue.revealImage) {
          problems.push({
            path: clueAt,
            message: `fasitbilde er lagt ved en ${clue.payload.kind}-clue`,
          })
        }
        if (category.pairedWith && !clue.fromLabel) {
          problems.push({
            path: clueAt,
            message: 'paret kategori krever fromLabel på hver clue',
          })
        }
      }
    }
  }

  return problems
}
