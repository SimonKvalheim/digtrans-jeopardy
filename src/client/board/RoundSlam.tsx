import type { BoardState } from '@shared/board-state.ts'

/**
 * The round-2 slam-in (PRD §3.1, §8.4).
 *
 * Announces the round *and the rule that comes with it* — lowest score picks
 * first — because that rule is invisible otherwise: the turn simply moves to a
 * team that did not earn it, and someone objects.
 */
export function RoundSlam({
  round,
  turnTeamName,
}: {
  round: NonNullable<BoardState['round']>
  turnTeamName: string | null
}) {
  return (
    <div className={`round-slam round-slam--${round.kind}`}>
      <h1 className="round-slam__title">
        {round.kind === 'double' ? 'Dobbel Jeopardy' : 'Ny runde'}
      </h1>
      <p className="round-slam__values">
        {round.valueStep} – {round.valueStep * 5}
        {' · '}
        {/* The one line worth saying out loud once: round 2 doubles the points
            and deliberately not the drinking (PRD §4.5). */}
        poengene dobles, slurkene gjør ikke det
      </p>
      {turnTeamName ? (
        <p className="round-slam__turn">
          Lavest poengsum velger først: <strong>{turnTeamName}</strong>
        </p>
      ) : null}
    </div>
  )
}
