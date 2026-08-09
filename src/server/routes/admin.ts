import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { packSchema, validateForPublish } from '../../shared/pack-schema.ts'
import { db, schema } from '../db/index.ts'
import { requireAdminPin } from '../auth.ts'

/**
 * Bulk pack import (PRD §6.2).
 *
 * Content is authored as JSON, never committed, and arrives here over HTTPS
 * behind ADMIN_PIN. Postgres is the only place it exists afterwards, which is
 * what lets the repo stay public.
 *
 * Validation is loud on purpose. A pack that is 59 good clues and one typo is
 * rejected whole, with the path to the bad clue, rather than half-imported.
 */
export const adminRouter = Router()

adminRouter.use(requireAdminPin)

adminRouter.post('/import', async (req, res) => {
  const parsed = packSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      error: 'Pakken er ugyldig',
      problems: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(rot)',
        message: issue.message,
      })),
    })
    return
  }

  const pack = parsed.data
  const publishProblems = validateForPublish(pack)
  const asDraft = req.query.draft === '1'

  if (publishProblems.length > 0 && !asDraft) {
    res.status(400).json({
      error: 'Pakken kan ikke publiseres',
      hint: 'Send den med ?draft=1 for å lagre den uferdig.',
      problems: publishProblems,
    })
    return
  }

  try {
    const summary = await db().transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: schema.packs.id })
        .from(schema.packs)
        .where(eq(schema.packs.slug, pack.slug))

      if (existing) {
        // A pack that has already been played is immutable: games reference it
        // and their score history would stop making sense. Use the clue editor
        // for a late typo instead.
        const [playedBy] = await tx
          .select({ id: schema.games.id })
          .from(schema.games)
          .where(eq(schema.games.packId, existing.id))
          .limit(1)

        if (playedBy) {
          throw new ImportConflict(
            `Pakken "${pack.slug}" er allerede i bruk av et spill. Bruk clue-editoren.`,
          )
        }

        // Cascades through rounds → categories → clues → clue_media.
        await tx.delete(schema.packs).where(eq(schema.packs.id, existing.id))
      }

      const [inserted] = await tx
        .insert(schema.packs)
        .values({
          slug: pack.slug,
          title: pack.title,
          locale: pack.locale,
          drinkScale: pack.drinkScale,
          publishedAt:
            publishProblems.length === 0 && !asDraft ? new Date() : null,
        })
        .returning({ id: schema.packs.id })

      const packId = inserted!.id
      let clueCount = 0
      let imageCount = 0

      for (const [roundIndex, round] of pack.rounds.entries()) {
        const [insertedRound] = await tx
          .insert(schema.rounds)
          .values({
            packId,
            kind: round.kind,
            position: roundIndex,
            valueStep: round.valueStep,
            dailyDoubles: round.dailyDoubles,
          })
          .returning({ id: schema.rounds.id })

        for (const [catIndex, category] of round.categories.entries()) {
          const [insertedCategory] = await tx
            .insert(schema.categories)
            .values({
              roundId: insertedRound!.id,
              name: category.name,
              pairedWith: category.pairedWith ?? null,
              position: catIndex,
            })
            .returning({ id: schema.categories.id })

          for (const clue of category.clues) {
            const [insertedClue] = await tx
              .insert(schema.clues)
              .values({
                categoryId: insertedCategory!.id,
                tier: clue.tier,
                answer: clue.answer,
                fromLabel: clue.fromLabel ?? null,
                // Derived, never supplied — the two cannot drift.
                kind: clue.payload.kind,
                payload: clue.payload,
              })
              .returning({ id: schema.clues.id })

            clueCount += 1

            if (clue.image) {
              await tx.insert(schema.clueMedia).values({
                clueId: insertedClue!.id,
                imageBytes: Buffer.from(clue.image.base64, 'base64'),
                imageMime: clue.image.mime,
              })
              imageCount += 1
            }
          }
        }
      }

      return {
        packId,
        slug: pack.slug,
        published: publishProblems.length === 0 && !asDraft,
        rounds: pack.rounds.length,
        clues: clueCount,
        images: imageCount,
      }
    })

    res.json({ ok: true, ...summary, problems: publishProblems })
  } catch (error) {
    if (error instanceof ImportConflict) {
      res.status(409).json({ error: error.message })
      return
    }
    console.error('[admin/import] failed', error)
    res.status(500).json({
      error: 'Import feilet',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
})

/** Everything already imported, so the editor and the host can pick a pack. */
adminRouter.get('/packs', async (_req, res) => {
  const rows = await db()
    .select({
      id: schema.packs.id,
      slug: schema.packs.slug,
      title: schema.packs.title,
      publishedAt: schema.packs.publishedAt,
    })
    .from(schema.packs)

  res.json({ packs: rows })
})

class ImportConflict extends Error {}
