import { useLayoutEffect, useRef } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { Countdown } from './Countdown.tsx'
import { clueKindFor, isRevealing } from '../clue-kinds.tsx'
import { FitText } from './FitText.tsx'
import { stageScale, tileRect } from './tile-rects.ts'
import { teamAccent } from './team-colours.ts'

/**
 * Grows the clue out of the tile that was picked (PRD §8.4).
 *
 * A FLIP, so the browser only ever animates a transform: the clue is laid out
 * at its final size and then played backwards from the tile's rectangle. The
 * offsets are divided by the stage scale because the board is drawn at a fixed
 * 1920×1080 and scaled to the TV, and the element's own transform lives inside
 * that scaled coordinate system.
 */
function useZoomFromTile(gameClueId: string) {
  const ref = useRef<HTMLDivElement>(null)
  const played = useRef<string | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const from = tileRect(gameClueId)
    // No measurement (a tile opened within a second of the round appearing, or
    // the board was reloaded straight into a clue) simply means no animation.
    if (!el || !from || played.current === gameClueId) return
    played.current = gameClueId

    const to = el.getBoundingClientRect()
    if (to.width === 0 || to.height === 0) return
    const scale = stageScale()

    el.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${(from.left - to.left) / scale}px, ${
            (from.top - to.top) / scale
          }px) scale(${from.width / to.width}, ${from.height / to.height})`,
          opacity: 0.35,
        },
        { transformOrigin: 'top left', transform: 'none', opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(.2,.85,.25,1)' },
    )
  }, [gameClueId])

  return ref
}

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
  const ref = useZoomFromTile(clue.id)

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
  const revealing = isRevealing(clue)

  // The buzz flash takes the winning team's colour, so the room can see who
  // got it from the far side without reading a word (PRD §8.4).
  const stealer = teams.find((t) => t.name === clue.stealWinner?.teamName)

  return (
    <div
      ref={ref}
      className={`clue clue--${clue.kind}${
        clue.stealWinner ? ' clue--buzzed' : ''
      }${revealing ? ' clue--revealed' : ''}`}
      style={{ '--team-accent': teamAccent(stealer?.seat) } as React.CSSProperties}
    >
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

      {/* The whole point of the change: the answer was only ever spoken, and a
          room of thirty with drinks in hand does not reliably hear it. FitText
          because the stage is a fixed 1920×1080 with overflow hidden — a long
          answer would be clipped in front of everyone rather than wrap.

          The floor is 24 rather than 40 because FitText stops shrinking at
          `min` and then simply overflows. Measured: the schema's 300-character
          maximum answer needs ~28px in the 160px band an image clue gives it,
          and 40 left 76px of gold hanging over the steal banner. Nothing
          shorter ever reaches the floor — the real answers land at 96. */}
      {revealing ? (
        <FitText
          className="clue__answer"
          text={clue.answer}
          max={96}
          min={24}
        />
      ) : null}

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
