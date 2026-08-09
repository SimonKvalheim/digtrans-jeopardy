import type { BoardTeam } from '@shared/board-state.ts'

/**
 * Sits under the board all evening. Negative scores are expected and are shown
 * in red rather than hidden — they are part of the fun.
 */
export function ScoreStrip({
  teams,
  turnTeamId,
}: {
  teams: BoardTeam[]
  turnTeamId: string | null
}) {
  if (teams.length === 0) {
    return (
      <div className="score-strip score-strip--empty">
        <span className="muted">Ingen lag ennå</span>
      </div>
    )
  }

  return (
    <div className="score-strip">
      {teams.map((team) => (
        <div
          key={team.id}
          className={`score-strip__team${
            team.id === turnTeamId ? ' score-strip__team--turn' : ''
          }`}
        >
          <div className="score-strip__name">{team.name}</div>
          <div
            className={`score-strip__score${
              team.score < 0 ? ' score-strip__score--negative' : ''
            }`}
          >
            {team.score}
          </div>
        </div>
      ))}
    </div>
  )
}
