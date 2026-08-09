import type { BoardState } from '@shared/board-state.ts'
import { hostFetch } from './api.ts'

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
  if (!board.round) return <p className="muted">Ingen aktiv runde.</p>

  const turnTeam = board.teams.find((t) => t.id === board.turnTeamId)

  const open = async (gameClueId: string) => {
    await hostFetch(`/games/${code}/open`, {
      method: 'POST',
      body: { gameClueId },
    })
    await onChanged()
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
    </div>
  )
}
