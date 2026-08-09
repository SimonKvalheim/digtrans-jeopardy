import { useEffect, useRef } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { sting } from './audio.ts'

/**
 * Turns board-state changes into sound (PRD §8.3).
 *
 * Driven off the polled state rather than off the actions that caused it,
 * because the board is not the surface that takes those actions — the host
 * console is. Everything the room hears is therefore a consequence of the same
 * state the room can see, which is also why a reload can never desync them.
 */
export function useStings(state: BoardState | null) {
  const prev = useRef<{
    primed: boolean
    clueId: string | null
    cluePhase: string | null
    steal: string | null
    roundId: string | null
    gamePhase: string | null
  }>({
    primed: false,
    clueId: null,
    cluePhase: null,
    steal: null,
    roundId: null,
    gamePhase: null,
  })

  useEffect(() => {
    if (!state) return

    const clue = state.activeClue
    const next = {
      primed: true,
      clueId: clue?.id ?? null,
      cluePhase: clue?.phase ?? null,
      steal: clue?.stealWinner?.teamName ?? null,
      roundId: state.round?.id ?? null,
      gamePhase: state.phase,
    }
    const was = prev.current
    prev.current = next

    // The first state to arrive describes a game already in progress. Playing
    // its sounds would mean a board reopened mid-clue announces a buzz that
    // happened ten minutes ago.
    if (!was.primed) return

    if (next.roundId && was.roundId && next.roundId !== was.roundId) {
      sting('roundStart')
    }

    if (!was.gamePhase?.startsWith('final') && next.gamePhase.startsWith('final')) {
      sting('final')
    }
    if (was.gamePhase !== 'final_done' && next.gamePhase === 'final_done') {
      sting('winner')
    }

    if (next.clueId && next.clueId !== was.clueId) {
      // A Daily Double slams gold before any clue text, so it gets the fanfare
      // and the ordinary open-blip is saved for when the question appears.
      sting(clue!.isDailyDouble ? 'dailyDouble' : 'tileOpen')
    } else if (next.clueId && next.clueId === was.clueId) {
      if (next.steal && !was.steal) sting('buzz')

      if (next.cluePhase !== was.cluePhase) {
        switch (next.cluePhase) {
          case 'dd_answer':
            sting('tileOpen')
            break
          case 'steal_open':
            sting('wrong')
            break
          case 'done':
            sting('correct')
            break
          case 'revealed':
            // Nobody buzzed and nobody was wagering alone — that is a triple
            // stumper, and the whole room drinks (PRD §4.5).
            sting(clue!.isDailyDouble || next.steal ? 'wrong' : 'stumper')
            break
        }
      }
    }
  }, [state])
}
