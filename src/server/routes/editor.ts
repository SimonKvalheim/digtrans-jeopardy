import { Router } from 'express'
import { asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { cluePayloadSchema } from '../../shared/clue-kinds.ts'
import {
  imageSchema,
  validateForPublish,
  type PackInput,
} from '../../shared/pack-schema.ts'
import { db, schema } from '../db/index.ts'
import { requireAdminPin } from '../auth.ts'

/**
 * The single-clue editor (PRD §6.2) — for the typo found at 20:00.
 *
 * Bulk import is all-or-nothing by design and refuses a pack that a game has
 * already been created from, because that game's score history references it.
 * That leaves no way at all to fix one word during the event, which is what
 * this is for. It edits content in place and never touches a game.
 *
 * Mounted under the same ADMIN_PIN as the importer.
 */
export const editorRouter = Router()

editorRouter.use(requireAdminPin)

const HAS_IMAGE = sql<boolean>`${schema.clueMedia.imageBytes} is not null`

/** The whole pack, answers and all. This is why /admin is PIN-gated. */
editorRouter.get('/packs/:slug', async (req, res) => {
  const [pack] = await db()
    .select()
    .from(schema.packs)
    .where(eq(schema.packs.slug, req.params.slug))

  if (!pack) {
    res.status(404).json({ error: 'Fant ikke pakken' })
    return
  }

  res.json({ pack, rounds: await treeFor(pack.id) })
})

interface TreeRow {
  roundId: string
  roundKind: 'jeopardy' | 'double' | 'final'
  roundPosition: number
  valueStep: number
  dailyDoubles: number
  categoryId: string | null
  categoryName: string | null
  pairedWith: string | null
  categoryPosition: number | null
  clueId: string | null
  tier: number | null
  answer: string | null
  fromLabel: string | null
  kind: string | null
  payload: unknown
  hasImage: boolean | null
  imageMime: string | null
}

/** Flat join rows back into rounds → categories → clues. */
function nest(rows: TreeRow[]) {
  const rounds = new Map<string, ReturnType<typeof emptyRound>>()

  for (const row of rows) {
    let round = rounds.get(row.roundId)
    if (!round) {
      round = emptyRound(row)
      rounds.set(row.roundId, round)
    }
    if (!row.categoryId) continue

    let category = round.categories.find((c) => c.id === row.categoryId)
    if (!category) {
      category = {
        id: row.categoryId,
        name: row.categoryName ?? '',
        pairedWith: row.pairedWith,
        position: row.categoryPosition ?? 0,
        clues: [],
      }
      round.categories.push(category)
    }
    if (!row.clueId) continue

    category.clues.push({
      id: row.clueId,
      tier: row.tier ?? 1,
      answer: row.answer ?? '',
      fromLabel: row.fromLabel,
      kind: row.kind ?? 'text',
      payload: row.payload,
      hasImage: Boolean(row.hasImage),
      imageMime: row.imageMime,
    })
  }

  return [...rounds.values()]
}

function emptyRound(row: TreeRow) {
  return {
    id: row.roundId,
    kind: row.roundKind,
    position: row.roundPosition,
    valueStep: row.valueStep,
    dailyDoubles: row.dailyDoubles,
    categories: [] as {
      id: string
      name: string
      pairedWith: string | null
      position: number
      clues: {
        id: string
        tier: number
        answer: string
        fromLabel: string | null
        kind: string
        payload: unknown
        hasImage: boolean
        imageMime: string | null
      }[]
    }[],
  }
}

const patchSchema = z.object({
  answer: z.string().min(1).max(300).optional(),
  fromLabel: z.string().max(60).nullable().optional(),
  payload: cluePayloadSchema.optional(),
})

/**
 * Edits one clue. The `kind` column is re-derived from the payload rather than
 * accepted from the client, exactly as on import, so the two cannot drift —
 * and so switching an image clue to text is a single legitimate edit rather
 * than a pair of writes that can half-fail.
 */
editorRouter.patch('/clues/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Ugyldig endring',
      problems: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(rot)',
        message: i.message,
      })),
    })
    return
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.answer !== undefined) update.answer = parsed.data.answer
  if (parsed.data.fromLabel !== undefined) update.fromLabel = parsed.data.fromLabel
  if (parsed.data.payload) {
    update.payload = parsed.data.payload
    update.kind = parsed.data.payload.kind
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'Ingenting å endre' })
    return
  }

  const [clue] = await db()
    .update(schema.clues)
    .set(update)
    .where(eq(schema.clues.id, req.params.id))
    .returning()

  if (!clue) {
    res.status(404).json({ error: 'Fant ikke klueen' })
    return
  }
  res.json({ ok: true, clue })
})

/**
 * Attaches or replaces one image.
 *
 * This is the path that matters on the morning of the event: the alternative
 * is re-sending the entire pack, which is a 40 MB request over a phone
 * connection and is refused outright once any game has been created from it.
 */
editorRouter.put('/clues/:id/image', async (req, res) => {
  const parsed = imageSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Ugyldig bilde — trenger mime og base64' })
    return
  }

  const [clue] = await db()
    .select({ id: schema.clues.id })
    .from(schema.clues)
    .where(eq(schema.clues.id, req.params.id))

  if (!clue) {
    res.status(404).json({ error: 'Fant ikke klueen' })
    return
  }

  const bytes = Buffer.from(parsed.data.base64, 'base64')
  if (bytes.length === 0) {
    res.status(400).json({ error: 'Bildet er tomt' })
    return
  }

  await db()
    .insert(schema.clueMedia)
    .values({ clueId: clue.id, imageBytes: bytes, imageMime: parsed.data.mime })
    .onConflictDoUpdate({
      target: schema.clueMedia.clueId,
      set: { imageBytes: bytes, imageMime: parsed.data.mime },
    })

  res.json({ ok: true, bytes: bytes.length, mime: parsed.data.mime })
})

/**
 * The image, addressed by **clues.id**.
 *
 * /api/media is keyed by game_clues.id — the per-night row — which is right for
 * the board and useless here: the editor is looking at content that may have no
 * game at all. Behind the admin PIN, so it is fetched with the header and shown
 * from a blob URL rather than put straight in an `src`.
 */
editorRouter.get('/clues/:id/image', async (req, res) => {
  const [row] = await db()
    .select({
      bytes: schema.clueMedia.imageBytes,
      mime: schema.clueMedia.imageMime,
    })
    .from(schema.clueMedia)
    .where(eq(schema.clueMedia.clueId, req.params.id))

  if (!row?.bytes) {
    res.status(404).json({ error: 'Ingen bildebytes for denne klueen' })
    return
  }

  // No caching at all: the whole point of this view is to confirm the image
  // that was uploaded ten seconds ago is the one now in the database.
  res.set('Cache-Control', 'no-store')
  res.type(row.mime ?? 'application/octet-stream')
  res.send(row.bytes)
})

editorRouter.delete('/clues/:id/image', async (req, res) => {
  // Only the image is cleared; any generated speech on the same row survives,
  // and so does the reveal picture.
  await db()
    .update(schema.clueMedia)
    .set({ imageBytes: null, imageMime: null })
    .where(eq(schema.clueMedia.clueId, req.params.id))
  res.json({ ok: true })
})

/** The same three operations for the reveal picture, on the same row. */
editorRouter.put('/clues/:id/reveal', async (req, res) => {
  const parsed = imageSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Ugyldig bilde — trenger mime og base64' })
    return
  }

  const [clue] = await db()
    .select({ id: schema.clues.id })
    .from(schema.clues)
    .where(eq(schema.clues.id, req.params.id))

  if (!clue) {
    res.status(404).json({ error: 'Fant ikke klueen' })
    return
  }

  const bytes = Buffer.from(parsed.data.base64, 'base64')
  if (bytes.length === 0) {
    res.status(400).json({ error: 'Bildet er tomt' })
    return
  }

  await db()
    .insert(schema.clueMedia)
    .values({ clueId: clue.id, revealBytes: bytes, revealMime: parsed.data.mime })
    .onConflictDoUpdate({
      target: schema.clueMedia.clueId,
      set: { revealBytes: bytes, revealMime: parsed.data.mime },
    })

  res.json({ ok: true, bytes: bytes.length, mime: parsed.data.mime })
})

editorRouter.get('/clues/:id/reveal', async (req, res) => {
  const [row] = await db()
    .select({
      bytes: schema.clueMedia.revealBytes,
      mime: schema.clueMedia.revealMime,
    })
    .from(schema.clueMedia)
    .where(eq(schema.clueMedia.clueId, req.params.id))

  if (!row?.bytes) {
    res.status(404).json({ error: 'Ingen fasitbilde for denne klueen' })
    return
  }

  res.set('Cache-Control', 'no-store')
  res.type(row.mime ?? 'application/octet-stream')
  res.send(row.bytes)
})

editorRouter.delete('/clues/:id/reveal', async (req, res) => {
  await db()
    .update(schema.clueMedia)
    .set({ revealBytes: null, revealMime: null })
    .where(eq(schema.clueMedia.clueId, req.params.id))
  res.json({ ok: true })
})

/**
 * Publishes what is in the database, re-running the very same rules the
 * importer applies.
 *
 * Without this, a pack whose images arrived one at a time through the editor
 * could never be published at all: publishing was a side effect of a full
 * import, and a full import is exactly what the editor exists to avoid.
 */
editorRouter.post('/packs/:slug/publish', async (req, res) => {
  const [pack] = await db()
    .select()
    .from(schema.packs)
    .where(eq(schema.packs.slug, req.params.slug))

  if (!pack) {
    res.status(404).json({ error: 'Fant ikke pakken' })
    return
  }

  const tree = await treeFor(pack.id)

  // Rebuilt into the importer's own input shape so publish means exactly what
  // it meant at import time, instead of a second set of rules drifting apart
  // from the first.
  const asInput: PackInput = {
    slug: pack.slug,
    title: pack.title,
    locale: pack.locale,
    drinkScale: pack.drinkScale,
    rounds: tree.map((round) => ({
      kind: round.kind,
      valueStep: round.valueStep,
      dailyDoubles: round.dailyDoubles,
      categories: round.categories.map((category) => ({
        name: category.name,
        pairedWith: category.pairedWith ?? undefined,
        clues: category.clues.map((clue) => ({
          tier: clue.tier as 1 | 2 | 3 | 4 | 5,
          answer: clue.answer,
          fromLabel: clue.fromLabel ?? undefined,
          payload: clue.payload as PackInput['rounds'][number]['categories'][number]['clues'][number]['payload'],
          // Only presence is ever checked, so the bytes stay in the database.
          image: clue.hasImage
            ? { mime: 'image/jpeg' as const, base64: 'x' }
            : undefined,
        })),
      })),
    })),
  }

  const problems = validateForPublish(asInput)
  if (problems.length > 0) {
    res.status(400).json({ error: 'Pakken kan ikke publiseres', problems })
    return
  }

  await db()
    .update(schema.packs)
    .set({ publishedAt: new Date() })
    .where(eq(schema.packs.id, pack.id))

  res.json({ ok: true, publishedAt: new Date().toISOString(), problems: [] })
})

/** The pack as a tree. Answers included — this router is PIN-gated. */
async function treeFor(packId: string) {
  const rows: TreeRow[] = await db()
    .select({
      roundId: schema.rounds.id,
      roundKind: schema.rounds.kind,
      roundPosition: schema.rounds.position,
      valueStep: schema.rounds.valueStep,
      dailyDoubles: schema.rounds.dailyDoubles,
      categoryId: schema.categories.id,
      categoryName: schema.categories.name,
      pairedWith: schema.categories.pairedWith,
      categoryPosition: schema.categories.position,
      clueId: schema.clues.id,
      tier: schema.clues.tier,
      answer: schema.clues.answer,
      fromLabel: schema.clues.fromLabel,
      kind: schema.clues.kind,
      payload: schema.clues.payload,
      // Presence, never the bytes: this is the whole pack in one response, and
      // sixty base64 photographs in it would be tens of megabytes on a phone.
      hasImage: HAS_IMAGE,
      imageMime: schema.clueMedia.imageMime,
    })
    .from(schema.rounds)
    .leftJoin(schema.categories, eq(schema.categories.roundId, schema.rounds.id))
    .leftJoin(schema.clues, eq(schema.clues.categoryId, schema.categories.id))
    .leftJoin(schema.clueMedia, eq(schema.clueMedia.clueId, schema.clues.id))
    .where(eq(schema.rounds.packId, packId))
    .orderBy(
      asc(schema.rounds.position),
      asc(schema.categories.position),
      asc(schema.clues.tier),
    )

  return nest(rows)
}

// ── Games ───────────────────────────────────────────────────────────────────

/** So the admin can see which games exist, and which pack each one locks. */
editorRouter.get('/games', async (_req, res) => {
  const rows = await db()
    .select({
      id: schema.games.id,
      code: schema.games.code,
      phase: schema.games.phase,
      createdAt: schema.games.createdAt,
      packSlug: schema.packs.slug,
    })
    .from(schema.games)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.games.packId))
    .orderBy(asc(schema.games.createdAt))

  res.json({ games: rows })
})

/**
 * Deletes a game and everything it accumulated.
 *
 * The reason this exists is narrow and important: import refuses to replace a
 * pack that any game references, so a single throwaway test game permanently
 * blocks re-importing the real pack. Discovering that at 09:00 on the day, with
 * thirteen images to add, would cost the morning.
 *
 * The code has to be echoed in the body. A PIN that was typed once hours ago is
 * not consent to delete tonight's game by mistyping a URL.
 */
editorRouter.delete('/games/:code', async (req, res) => {
  const code = req.params.code.toUpperCase()
  if (String(req.body?.confirm ?? '').toUpperCase() !== code) {
    res.status(400).json({ error: `Skriv ${code} for å bekrefte` })
    return
  }

  const [deleted] = await db()
    .delete(schema.games)
    .where(eq(schema.games.code, code))
    .returning({ id: schema.games.id, code: schema.games.code })

  if (!deleted) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }
  res.json({ ok: true, ...deleted })
})
