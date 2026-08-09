import { z } from 'zod'

/**
 * Clue kinds are a plugin registry, not a switch statement (PRD §6.4).
 *
 * Adding a kind means: a payload schema here, a board renderer, and an optional
 * host control. Nothing in the core game loop changes.
 *
 * The payload carries its own `kind` discriminator and the `clues.kind` column
 * is derived from it on import, so the two can never drift apart.
 */

const prompt = z.string().min(1, 'prompt kan ikke være tom').max(600)

export const cluePayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    prompt,
  }),
  z.strictObject({
    kind: z.literal('emoji'),
    // Rendered enormous on the TV, so a long string defeats the point.
    prompt: z.string().min(1).max(40),
  }),
  z.strictObject({
    kind: z.literal('image'),
    prompt,
    // The bytes arrive alongside the clue as base64 and land in clue_media.
  }),
  z.strictObject({
    kind: z.literal('audio_host'),
    prompt,
    // Host phone is the music player; this renders as a tappable card.
    link: z.url('link må være en gyldig URL'),
    hint: z.string().max(200).default(''),
  }),
  // Declared now to prove the seam is real. Not Tuesday work.
  z.strictObject({
    kind: z.literal('audio_file'),
    prompt,
  }),
  z.strictObject({
    kind: z.literal('video'),
    prompt,
    start: z.number().int().nonnegative().optional(),
  }),
])

export type CluePayload = z.infer<typeof cluePayloadSchema>
export type ClueKind = CluePayload['kind']

/** Kinds that are actually wired up for the event. */
export const KINDS_READY = ['text', 'emoji', 'image', 'audio_host'] as const
export type ReadyClueKind = (typeof KINDS_READY)[number]

export function isReadyKind(kind: ClueKind): kind is ReadyClueKind {
  return (KINDS_READY as readonly string[]).includes(kind)
}
