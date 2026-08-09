import type { BoardState } from '@shared/board-state.ts'
import { Countdown } from './Countdown.tsx'
import { clueKindFor } from '../clue-kinds.tsx'

/**
 * The open tile, full-bleed on the TV. Carries the prompt and never the answer.
 *
 * What sits in the middle comes from the clue-kind registry, so adding a kind
 * is a renderer and not an edit here (PRD §6.4).
 */
export function ClueView({
  clue,
  teams,
}: {
  clue: NonNullable<BoardState['activeClue']>
  teams: BoardState['teams']
}) {
  const owner = teams.find((t) => t.id === clue.ownerTeamId)

  if (clue.phase === 'dd_wager') {
    return (
      <div className="clue clue--daily-double">
        <h1>Dagens doble</h1>
        <p className="clue__dd-team">{owner?.name ?? 'Laget'} satser…</p>
      </div>
    )
  }

  // A team that wagered everything has earned the room's attention before it
  // answers, not after. True Daily Double → the whole room drinks (PRD §4.4).
  const allIn =
    clue.isDailyDouble &&
    clue.wager !== null &&
    owner !== undefined &&
    owner.score > 0 &&
    clue.wager === owner.score

  const KindBoard = clueKindFor(clue.kind).Board

  return (
    <div className={`clue clue--${clue.kind}`}>
      <div className="clue__header">
        <span>
          {clue.categoryName}
          {clue.fromLabel ? ` · ${clue.fromLabel}` : ''}
        </span>
        {/* "Innsats" is reserved for a real wager. An ordinary tile has a
            value the team never chose, so calling it a stake would be wrong. */}
        <span className="clue__value">
          <span className="clue__value-label">
            {clue.isDailyDouble ? 'Innsats' : 'Verdi'}
          </span>
          {clue.isDailyDouble ? (clue.wager ?? 0) : clue.value}
        </span>
      </div>

      {allIn ? (
        <p className="clue__all-in">Ekte dagens doble — hele potten!</p>
      ) : null}

      <KindBoard clue={clue} />

      {/* The margin is shown on purpose: it is what stops the argument. */}
      {clue.stealWinner ? (
        <p className="clue__buzz-winner">
          {clue.stealWinner.teamName} stjeler
          {clue.stealWinner.marginMs > 0
            ? ` — ${clue.stealWinner.marginMs} ms foran`
            : ''}
        </p>
      ) : null}

      {clue.phaseEndsAt ? (
        <Countdown
          endsAt={clue.phaseEndsAt}
          totalMs={clue.phase === 'steal_open' ? 10_000 : 30_000}
        />
      ) : null}

      <div className="clue__footer">
        {/* Buy-in only. The app displays sips and never tracks them. */}
        <span className="clue__sips">{clue.sips} slurker å prøve</span>
        {clue.phase === 'steal_open' ? (
          <span className="clue__steal">Stjeling åpen!</span>
        ) : owner ? (
          <span>{owner.name}</span>
        ) : null}
      </div>
    </div>
  )
}
