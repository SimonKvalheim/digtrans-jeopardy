import type { BoardTeam } from '@shared/board-state.ts'
import { Countdown } from './Countdown.tsx'
import { Confetti } from './Confetti.tsx'

export interface FinalBet {
  teamId: string
  teamName: string
  score: number
  wagerLocked: boolean
  answerLocked: boolean
  verdict: string | null
  wager: number | null
  answer: string | null
}

export interface FinalStateView {
  phase: string
  prompt: string | null
  bets: FinalBet[]
}

/**
 * Final Jeopardy on the TV.
 *
 * During the wager phase this shows only *who has committed*, never what they
 * committed — the wager is blind, and a number on a two-metre screen is not.
 */
export function FinalView({
  state,
  teams,
  endsAt,
}: {
  state: FinalStateView
  teams: BoardTeam[]
  endsAt: string | null
}) {
  const playingIds = new Set(state.bets.map((b) => b.teamId))
  const eliminated = teams.filter((t) => !playingIds.has(t.id))

  if (state.phase === 'final_wager') {
    return (
      <div className="final">
        <h1 className="final__title">Final Jeopardy</h1>
        <p className="final__blind">Ingen kategori. Ingen hint. Satse blindt.</p>

        <div className="final__locks">
          {state.bets.map((bet) => (
            <div
              key={bet.teamId}
              className={`final__lock${bet.wagerLocked ? ' final__lock--done' : ''}`}
            >
              <span>{bet.teamName}</span>
              <strong>{bet.wagerLocked ? 'Låst' : 'Satser…'}</strong>
            </div>
          ))}
        </div>

        {eliminated.length > 0 ? (
          <p className="final__out">
            Ute av finalen: {eliminated.map((t) => t.name).join(' · ')} — null
            eller under.
          </p>
        ) : null}
      </div>
    )
  }

  if (state.phase === 'final_clue') {
    return (
      <div className="final">
        <p className="final__prompt">{state.prompt}</p>
        {endsAt ? <Countdown endsAt={endsAt} totalMs={60_000} /> : null}
        <div className="final__locks">
          {state.bets.map((bet) => (
            <div
              key={bet.teamId}
              className={`final__lock${bet.answerLocked ? ' final__lock--done' : ''}`}
            >
              <span>{bet.teamName}</span>
              <strong>{bet.answerLocked ? 'Svart' : 'Skriver…'}</strong>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Reveal and standings.
  const ranked = [...state.bets].sort((a, b) => b.score - a.score)

  return (
    <div className="final">
      {/* Mounts when the standings appear and runs itself out. The reveal and
          the standings share this branch, so it is the phase check that keeps
          confetti off the screen while teams are still being judged. */}
      {state.phase === 'final_done' ? <Confetti /> : null}

      <h1 className="final__title">
        {state.phase === 'final_done' ? 'Stillingen' : 'Svarene'}
      </h1>
      {state.prompt ? <p className="final__prompt-small">{state.prompt}</p> : null}

      <div className="final__reveals">
        {ranked.map((bet) => (
          <div
            key={bet.teamId}
            className={`final__reveal final__reveal--${bet.verdict ?? 'pending'}`}
          >
            <span className="final__reveal-team">{bet.teamName}</span>
            <span className="final__reveal-answer">
              {bet.answer ?? <em>intet svar</em>}
            </span>
            <span className="final__reveal-wager">
              {bet.verdict === 'correct'
                ? `+${bet.wager}`
                : bet.verdict === 'wrong'
                  ? `−${bet.wager}`
                  : `${bet.wager ?? '?'}`}
            </span>
            <span className="final__reveal-score">{bet.score}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
