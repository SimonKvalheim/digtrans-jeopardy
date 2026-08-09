import type { BoardState } from '@shared/board-state.ts'
import { QrCode } from './QrCode.tsx'

/**
 * What the TV shows while teams join (PRD §3.1).
 *
 * Until this existed there was no way for anyone in the room to discover how to
 * join at all — the team phone lives at /t and nothing said so. The join URL is
 * spelled out as well as encoded, because someone always has a camera that
 * refuses and it is faster to type six characters than to debug their phone.
 */
export function LobbyView({ state }: { state: BoardState }) {
  // Derived from wherever the board is actually being served, so this is right
  // on Railway, on a custom domain, and on a laptop in dev, with nothing to
  // keep in sync.
  const joinUrl = `${window.location.origin}/t?code=${encodeURIComponent(state.code)}`
  const shown = joinUrl.replace(/^https?:\/\//, '')

  return (
    <div className="lobby">
      <div className="lobby__left">
        <h1 className="lobby__title">Jeopardy</h1>
        <p className="lobby__lead">Ett lag, én telefon. Skann eller skriv:</p>
        <p className="lobby__url">{shown}</p>

        <div className="lobby__code">
          <span className="lobby__code-label">Romkode</span>
          <strong className="lobby__code-value">{state.code}</strong>
        </div>

        <div className="lobby__teams">
          {state.teams.length === 0 ? (
            <span className="lobby__waiting">Venter på lag…</span>
          ) : (
            state.teams.map((team) => (
              <span key={team.id} className="lobby__team">
                {team.name}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="lobby__qr">
        <QrCode value={joinUrl} size={520} className="lobby__qr-img" />
      </div>
    </div>
  )
}
