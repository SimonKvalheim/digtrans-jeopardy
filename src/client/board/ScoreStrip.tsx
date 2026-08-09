import type { BoardTeam } from '@shared/board-state.ts'
import { useCountUp } from './useCountUp.ts'

/** One card, so each score can run to its new value independently. */
function TeamCard({ team, isTurn }: { team: BoardTeam; isTurn: boolean }) {
  const shown = useCountUp(team.score)

  return (
    <div className={`score-strip__team${isTurn ? ' score-strip__team--turn' : ''}`}>
      <div className="score-strip__name">{team.name}</div>
      <div
        className={`score-strip__score${
          // Keyed off the settled score, not the one mid-count: a team crossing
          // zero on the way up should not flicker red on the last frame.
          team.score < 0 ? ' score-strip__score--negative' : ''
        }`}
      >
        {shown}
      </div>
    </div>
  )
}

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
        <TeamCard key={team.id} team={team} isTurn={team.id === turnTeamId} />
      ))}
    </div>
  )
}
