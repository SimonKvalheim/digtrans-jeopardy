import { Router } from 'express'
import { buildBoardState } from '../game/state.ts'

/**
 * Read-only and unauthenticated on purpose: the TV is a borrowed laptop that
 * nobody wants to type a PIN into, and buildBoardState deliberately returns no
 * clue text and no answers.
 */
export const boardRouter = Router()

boardRouter.get('/:code', async (req, res) => {
  const state = await buildBoardState(req.params.code)
  if (!state) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }
  res.json(state)
})
