import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { Stage } from '../Stage.tsx'
import { BoardGrid } from '../board/BoardGrid.tsx'
import { ScoreStrip } from '../board/ScoreStrip.tsx'
import { ClueView } from '../board/ClueView.tsx'
import { useGameSocket } from '../team/useGameSocket.ts'
import { FinalView, type FinalStateView } from '../board/FinalView.tsx'
import { RoundSlam } from '../board/RoundSlam.tsx'
import { LobbyView } from '../board/LobbyView.tsx'
import { StartGate } from '../board/StartGate.tsx'
import { unlockAudio } from '../board/audio.ts'
import { useStings } from '../board/useStings.ts'

/** Long enough to read the rule off the TV, short enough not to stall play. */
const SLAM_MS = 4200

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
  const [final, setFinal] = useState<FinalStateView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])

  /**
   * The one tap the board is allowed to need (PRD §8.1). Browsers will not let
   * a page make a sound until a real gesture, and this board is designed to be
   * opened and walked away from — so without this screen the room gets a silent
   * game and no visible reason why.
   */
  const [started, setStarted] = useState(false)
  const start = useCallback(() => {
    // Fullscreen first and synchronously: awaiting the audio context before
    // asking can spend the user activation, and then the TV stays windowed.
    document.documentElement.requestFullscreen?.().catch(() => {})
    void unlockAudio()
    setStarted(true)
  }, [])

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
        if (cancelled) return
        setState(next)
        setError(null)

        if (next.phase.startsWith('final')) {
          const finalRes = await fetch(
            `/api/board/${encodeURIComponent(code)}/final`,
          )
          if (finalRes.ok && !cancelled) {
            setFinal((await finalRes.json()) as FinalStateView)
          }
        } else if (!cancelled) {
          setFinal(null)
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
  }, [code, reloadKey])

  // All sound comes out of the TV (PRD §8.1), so this lives here and nowhere
  // near the host console or a team phone.
  useStings(state)

  // The round-2 slam-in. Fires on a *change* of round, never on the first
  // round seen — otherwise reopening the laptop mid-game replays the fanfare
  // for a round the room has been playing for twenty minutes.
  const [slamming, setSlamming] = useState(false)
  const seenRound = useRef<string | null>(null)
  const roundId = state?.round?.id ?? null

  useEffect(() => {
    if (!roundId) return
    if (seenRound.current === null) {
      seenRound.current = roundId
      return
    }
    if (seenRound.current === roundId) return
    seenRound.current = roundId
    setSlamming(true)
    const timer = setTimeout(() => setSlamming(false), SLAM_MS)
    return () => clearTimeout(timer)
  }, [roundId])

  // Polling above is the safety net; this is what makes a buzz land on the TV
  // immediately rather than up to two seconds later.
  useGameSocket({
    role: 'board',
    gameId: state?.gameId,
    onMessage: (msg) => {
      if (msg.type === 'changed') void reload()
    },
  })

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

  const inLobby = state.phase === 'lobby' && !state.activeClue

  return (
    <Stage>
      {/* The compact gate is a strip along the bottom edge, so the board has to
          give up the same 64px rather than have it laid over the score strip —
          measured at a 32px overlap that clipped the numerals. */}
      <div
        className={`board${!started && !inLobby ? ' board--gated' : ''}`}
      >
        {inLobby ? (
          <LobbyView state={state} />
        ) : final ? (
          <FinalView
            state={final}
            teams={state.teams}
            endsAt={state.activeClue?.phaseEndsAt ?? null}
          />
        ) : slamming && state.round ? (
          <RoundSlam
            round={state.round}
            turnTeamName={
              state.teams.find((t) => t.id === state.turnTeamId)?.name ?? null
            }
          />
        ) : state.activeClue ? (
          <ClueView clue={state.activeClue} teams={state.teams} />
        ) : state.round ? (
          // Keyed on the round so the grid genuinely remounts and its tiles
          // cascade in again, rather than the new round's values quietly
          // appearing in the old round's boxes.
          <BoardGrid key={state.round.id} round={state.round} />
        ) : (
          <div className="board__notice">
            <h1>Venter på runde</h1>
          </div>
        )}
        {/* The lobby has its own list of who has joined; a score strip of five
            zeroes under it is noise. */}
        {inLobby ? null : (
          <ScoreStrip teams={state.teams} turnTeamId={state.turnTeamId} />
        )}

        {started ? null : <StartGate compact={!inLobby} onStart={start} />}
      </div>
    </Stage>
  )
}
