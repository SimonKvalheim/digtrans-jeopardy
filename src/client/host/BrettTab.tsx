import { useCallback, useEffect, useState } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { hostFetch } from './api.ts'

export interface RoundProgress {
  id: string
  kind: 'jeopardy' | 'double' | 'final'
  position: number
  valueStep: number
  tiles: number
  spent: number
  active: boolean
}

/** What the host calls it out loud. */
export function roundLabel(round: RoundProgress): string {
  if (round.kind === 'final') return 'Finale'
  if (round.kind === 'double') return 'Dobbel Jeopardy'
  return `Runde ${round.position + 1}`
}

/**
 * Compact tile picker. Spent tiles are greyed and unpickable, so the tile the
 * host taps by accident is never one that has already been played.
 *
 * Daily Doubles are deliberately not marked here: the host finds out when the
 * board slams, same as the room.
 */
export function BrettTab({
  board,
  code,
  onChanged,
}: {
  board: BoardState
  code: string
  onChanged: () => void | Promise<void>
}) {
  const [rounds, setRounds] = useState<RoundProgress[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRounds = useCallback(async () => {
    try {
      const data = await hostFetch<{ rounds: RoundProgress[] }>(
        `/games/${code}/rounds`,
      )
      setRounds(data.rounds)
    } catch {
      // The tile picker is what this tab is for; losing the round switcher is
      // not worth taking it down.
    }
  }, [code])

  useEffect(() => {
    void loadRounds()
  }, [loadRounds, board.round?.id, board.round?.categories])

  if (!board.round) return <p className="muted">Ingen aktiv runde.</p>

  const turnTeam = board.teams.find((t) => t.id === board.turnTeamId)

  const open = async (gameClueId: string) => {
    await hostFetch(`/games/${code}/open`, {
      method: 'POST',
      body: { gameClueId },
    })
    await onChanged()
  }

  const playable = rounds.filter((r) => r.kind !== 'final')
  const currentIndex = playable.findIndex((r) => r.active)
  const current = playable[currentIndex]
  const next = playable[currentIndex + 1]
  const left = current ? current.tiles - current.spent : 0

  const setLobbyOpen = async (open: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await hostFetch(`/games/${code}/lobby`, {
        method: 'POST',
        body: { open },
      })
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  const goTo = async (roundId?: string) => {
    setBusy(true)
    setError(null)
    try {
      await hostFetch(`/games/${code}/round`, {
        method: 'POST',
        body: roundId ? { roundId } : {},
      })
      setConfirming(false)
      await Promise.all([loadRounds(), onChanged()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="brett">
      <p className="brett__turn">
        {turnTeam ? (
          <>
            Tur: <strong>{turnTeam.name}</strong>
          </>
        ) : (
          <span className="muted">Ingen tur satt — velg lag i Poeng.</span>
        )}
      </p>

      <div
        className="brett__grid"
        style={{
          gridTemplateColumns: `repeat(${board.round.categories.length}, 1fr)`,
        }}
      >
        {board.round.categories.map((category) => (
          <div key={category.id} className="brett__cat">
            {category.name}
          </div>
        ))}

        {[1, 2, 3, 4, 5].map((tier) =>
          board.round!.categories.map((category) => {
            const tile = category.tiles.find((t) => t.tier === tier)
            if (!tile) {
              return (
                <div
                  key={`${category.id}-${tier}`}
                  className="brett__tile brett__tile--empty"
                />
              )
            }
            return (
              <button
                key={tile.id}
                type="button"
                className={`brett__tile${tile.spent ? ' brett__tile--spent' : ''}`}
                disabled={tile.spent}
                onClick={() => void open(tile.id)}
              >
                {tile.value}
              </button>
            )
          }),
        )}
      </div>

      {/* Round advance. Two taps when tiles are still live, because a stray
          thumb here wipes the board the room is halfway through. */}
      <div className="brett__rounds">
        {/* The lobby is a screen the host raises and lowers, not a stage that
            is passed through once — a team turning up late still needs
            something to scan. */}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void setLobbyOpen(board.phase !== 'lobby')}
        >
          {board.phase === 'lobby' ? 'Skjul lobby — vis brettet' : 'Vis lobby (kode + QR)'}
        </button>

        <div className="brett__rounds-chips">
          {playable.map((round) => (
            <button
              key={round.id}
              type="button"
              className={`chip${round.active ? ' chip--active' : ''}`}
              disabled={busy || round.active}
              onClick={() => void goTo(round.id)}
            >
              {roundLabel(round)} · {round.spent}/{round.tiles}
            </button>
          ))}
        </div>

        {next ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => (confirming || left === 0 ? goTo() : setConfirming(true))}
          >
            {confirming
              ? `Sikker? ${left} ruter er ikke spilt`
              : `Neste runde → ${roundLabel(next)}`}
          </button>
        ) : (
          <p className="muted">
            {left === 0
              ? 'Alle ruter spilt. Start finalen i Final-fanen.'
              : `Siste runde — ${left} ruter igjen.`}
          </p>
        )}

        {error ? <p className="host__error">{error}</p> : null}
      </div>
    </div>
  )
}
