import { useEffect, useState } from 'react'
import { hostFetch, hostSession } from './api.ts'

export interface HostGameRow {
  code: string
  phase: string
  packSlug: string
  createdAt: string
  teams: number
}

/** What the host calls the phase out loud, rather than the database's word. */
function phaseLabel(phase: string): string {
  if (phase === 'lobby') return 'Lobby'
  if (phase === 'board') return 'I gang'
  if (phase.startsWith('final')) return 'Finale'
  return phase
}

/**
 * Switching which game the console is driving.
 *
 * The code was typed once at the gate and then lived in localStorage forever,
 * so going from a rehearsal game to the real one meant clearing browser storage
 * on a phone, in a dark room, with people waiting. It is a sheet rather than a
 * dropdown because it is pressed with a thumb.
 */
export function GamePicker({
  current,
  onPick,
  onClose,
}: {
  current: string
  onPick: (code: string) => void
  onClose: () => void
}) {
  const [games, setGames] = useState<HostGameRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setGames((await hostFetch<{ games: HostGameRow[] }>('/games')).games)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kunne ikke hente spill')
      }
    })()
  }, [])

  const pick = (code: string) => {
    hostSession.setCode(code)
    onPick(code)
    onClose()
  }

  return (
    <div className="picker" role="dialog" aria-label="Bytt spill">
      <div className="picker__sheet">
        <div className="picker__head">
          <h2>Bytt spill</h2>
          <button type="button" className="picker__close" onClick={onClose}>
            Lukk
          </button>
        </div>

        {error ? <p className="host__error">{error}</p> : null}
        {!games && !error ? <p className="muted">Henter…</p> : null}

        <div className="picker__list">
          {games?.map((game) => (
            <button
              key={game.code}
              type="button"
              className={`picker__game${
                game.code === current ? ' picker__game--current' : ''
              }`}
              onClick={() => pick(game.code)}
            >
              <span className="picker__code">{game.code}</span>
              <span className="picker__meta">
                {phaseLabel(game.phase)} · {game.teams} lag
                <em>{game.packSlug}</em>
              </span>
            </button>
          ))}
        </div>

        {games?.length === 0 ? (
          <p className="muted">Ingen spill finnes ennå.</p>
        ) : null}

        <p className="picker__note">
          Bytter bare hva denne telefonen styrer. Spillene står som de står.
        </p>
      </div>
    </div>
  )
}
