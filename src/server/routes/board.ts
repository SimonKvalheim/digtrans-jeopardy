import { Router } from 'express'
import { buildBoardState } from '../game/state.ts'
import { finalState } from '../game/final.ts'

/**
 * Read-only and unauthenticated on purpose: the TV is a borrowed laptop that
 * nobody wants to type a PIN into.
 *
 * What that costs: everything this route returns is readable by anyone who can
 * guess a four-letter code, so buildBoardState returns no clue text for a tile
 * that has not been opened, and no answer for a clue that is not already over.
 * The one gate that matters is in buildActiveClue — a clue in `steal_open` is
 * one a team is still allowed to answer.
 */
export const boardRouter = Router()

/** Final state for the TV. `false` keeps wagers and answers sealed. */
boardRouter.get('/:code/final', async (req, res) => {
  try {
    res.json(await finalState(req.params.code, false))
  } catch (error) {
    res.status(404).json({
      error: error instanceof Error ? error.message : 'Ukjent feil',
    })
  }
})

boardRouter.get('/:code', async (req, res) => {
  const state = await buildBoardState(req.params.code)
  if (!state) {
    res.status(404).json({ error: 'Fant ikke spillet' })
    return
  }
  res.json(state)
})
