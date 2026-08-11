import { createHash } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db, schema } from '../db/index.ts'

/**
 * Serves the bytes that arrived with a pack import (PRD §6.2).
 *
 * Unauthenticated, like the rest of the board's read path: the TV is a borrowed
 * laptop nobody wants to type a PIN into. What keeps this closed is the key —
 * it is addressed by **game_clues.id**, the per-night row, which is exactly the
 * id the board already holds. Content ids never leave the server, so a leaked
 * URL is one tile of one game and not a handle on the pack.
 */
export const mediaRouter = Router()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Revalidate every time, and answer almost all of it with a 304.
 *
 * Not `immutable`: the clue editor can replace an image at 20:00, and a board
 * holding a year-long cached copy of the old one would be unfixable without
 * clearing browser storage on a borrowed laptop. The board prefetches every
 * image in the round when the grid renders, so the bytes are already local long
 * before a tile opens — freshness costs a conditional request, not a download.
 */
const CACHE_CONTROL = 'public, max-age=30, must-revalidate'

/**
 * The question picture and the reveal picture differ only in which pair of
 * columns they read, so they share a handler. Note the reveal is served on the
 * same open terms as the question: it is not a secret the board is keeping —
 * the board simply does not ask for it until the answer is out.
 */
const serveImage =
  (bytesColumn: AnyPgColumn, mimeColumn: AnyPgColumn) =>
  async (req: Request<{ gameClueId: string }>, res: Response) => {
    const { gameClueId } = req.params

    // Postgres throws on a malformed uuid comparison, so this is a guard against
    // a 500 rather than a validation nicety.
    if (!UUID.test(gameClueId)) {
      res.status(404).json({ error: 'Fant ikke bildet' })
      return
    }

    const [row] = await db()
      .select({ bytes: bytesColumn, mime: mimeColumn })
      .from(schema.gameClues)
      .innerJoin(
        schema.clueMedia,
        eq(schema.clueMedia.clueId, schema.gameClues.clueId),
      )
      .where(eq(schema.gameClues.id, gameClueId))

    if (!row?.bytes) {
      // A clue with no image yet is a normal state during authoring, not an
      // error worth logging — the board falls back to the prompt alone.
      res.status(404).json({ error: 'Ingen bildebytes for denne ruten' })
      return
    }

    const etag = `"${createHash('sha1').update(row.bytes).digest('base64url')}"`

    res.set('Cache-Control', CACHE_CONTROL)
    res.set('ETag', etag)
    res.type(row.mime ?? 'application/octet-stream')

    if (req.get('if-none-match') === etag) {
      res.status(304).end()
      return
    }

    res.send(row.bytes)
  }

mediaRouter.get(
  '/:gameClueId/image',
  serveImage(schema.clueMedia.imageBytes, schema.clueMedia.imageMime),
)

/** The whole picture, once the answer is out. */
mediaRouter.get(
  '/:gameClueId/reveal',
  serveImage(schema.clueMedia.revealBytes, schema.clueMedia.revealMime),
)
