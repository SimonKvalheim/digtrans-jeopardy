import { useEffect, useState } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { Stage } from '../Stage.tsx'
import { BoardGrid } from '../board/BoardGrid.tsx'
import { ScoreStrip } from '../board/ScoreStrip.tsx'

/**
 * The TV. Zero interaction: it is opened once, fullscreened, and left alone.
 *
 * The room code lives in the URL (`/?code=XYZW`) so that reopening the laptop
 * or reloading after someone closes the lid restores the same board with no
 * input at all.
 */
export function BoardScreen() {
  const code = new URLSearchParams(window.location.search).get('code') ?? ''
  const [state, setState] = useState<BoardState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) {
      setError('Legg til ?code=XXXX i adressen.')
      return
    }

    let cancelled = false

    // Polling until the WebSocket carries board updates. Slow on purpose:
    // nothing here is latency-sensitive yet, and the buzz path will not use it.
    const load = async () => {
      try {
        const res = await fetch(`/api/board/${encodeURIComponent(code)}`)
        if (!res.ok) throw new Error(`Fant ikke spillet «${code}»`)
        const next = (await res.json()) as BoardState
        if (!cancelled) {
          setState(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Ukjent feil')
        }
      }
    }

    void load()
    const timer = setInterval(load, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [code])

  if (error) {
    return (
      <Stage>
        <div className="board__notice">
          <h1>Jeopardy</h1>
          <p className="muted">{error}</p>
        </div>
      </Stage>
    )
  }

  if (!state) {
    return (
      <Stage>
        <div className="board__notice">
          <h1>Kobler til…</h1>
        </div>
      </Stage>
    )
  }

  return (
    <Stage>
      <div className="board">
        {state.round ? (
          <BoardGrid round={state.round} />
        ) : (
          <div className="board__notice">
            <h1>Venter på runde</h1>
          </div>
        )}
        <ScoreStrip teams={state.teams} turnTeamId={state.turnTeamId} />
      </div>
    </Stage>
  )
}
