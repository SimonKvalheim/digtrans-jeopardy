import { useState } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { hostFetch } from './api.ts'
import { WagerPanel, type WagerLimit } from './WagerPanel.tsx'

export interface ActiveClue {
  gameClueId: string
  phase: string
  ownerTeamId: string | null
  isDailyDouble: boolean
  wager: number | null
  tier: number
  value: number
  answer: string
  kind: string
  payload: { kind: string; prompt: string; link?: string; hint?: string }
  fromLabel: string | null
  categoryName: string
}

/**
 * Question, answer key, and the two buttons pressed two hundred times tonight.
 *
 * The answer is shown only after a deliberate tap: it is far too easy to hold a
 * phone where someone can read it, and the whole PIN gate is pointless if the
 * key is on screen by default.
 */
export function SporTab({
  active,
  wagerLimit,
  board,
  code,
  onChanged,
}: {
  active: ActiveClue | null
  wagerLimit: WagerLimit | null
  board: BoardState
  code: string
  onChanged: () => void | Promise<void>
}) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [stealTeamId, setStealTeamId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!active) {
    return <p className="muted">Ingen rute åpen. Velg én i Brett.</p>
  }

  const owner = board.teams.find((t) => t.id === active.ownerTeamId)
  const stealOpen = active.phase === 'steal_open'
  const finished = active.phase === 'done' || active.phase === 'revealed'

  // The wager is blind and comes before any clue text — so this panel replaces
  // the question entirely rather than sitting above it.
  if (active.phase === 'dd_wager') {
    return wagerLimit ? (
      <WagerPanel
        limit={wagerLimit}
        teamName={owner?.name ?? 'Laget'}
        code={code}
        onChanged={onChanged}
      />
    ) : (
      <p className="muted">Laster innsatsgrense…</p>
    )
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  const resolve = (outcome: string, teamId?: string) =>
    act(() =>
      hostFetch(`/games/${code}/resolve`, {
        method: 'POST',
        body: { outcome, teamId },
      }),
    )

  const close = () =>
    act(async () => {
      await hostFetch(`/games/${code}/close`, { method: 'POST' })
      setShowAnswer(false)
      setStealTeamId(null)
    })

  return (
    <div className="spor">
      <div className="spor__meta">
        <span>{active.categoryName}</span>
        <span className="spor__value">
          {active.isDailyDouble
            ? `DOBLE · ${active.wager ?? 0}`
            : active.value}
        </span>
      </div>

      <p className="spor__prompt">{active.payload.prompt}</p>

      {/* The host phone is also the music player for audio_host clues. */}
      {active.payload.kind === 'audio_host' && active.payload.link ? (
        <a
          className="btn btn--primary spor__spotify"
          href={active.payload.link}
          target="_blank"
          rel="noreferrer"
        >
          ▶ Spill av{active.payload.hint ? ` — ${active.payload.hint}` : ''}
        </a>
      ) : null}

      {showAnswer ? (
        <p className="spor__answer">{active.answer}</p>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={() => setShowAnswer(true)}
        >
          Vis fasit
        </button>
      )}

      <p className="spor__owner muted">
        {owner ? `Svarer: ${owner.name}` : 'Ingen eier satt'}
      </p>

      {error ? <p className="host__error">{error}</p> : null}

      {finished ? (
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={close}
        >
          Lukk ruten og gi turen videre
        </button>
      ) : stealOpen ? (
        <div className="spor__steal">
          <p className="spor__steal-title">Stjeling åpen — hvem svarte?</p>
          <div className="spor__steal-teams">
            {board.teams
              .filter((t) => t.id !== active.ownerTeamId)
              .map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`chip${stealTeamId === team.id ? ' chip--active' : ''}`}
                  onClick={() => setStealTeamId(team.id)}
                >
                  {team.name}
                </button>
              ))}
          </div>
          <div className="spor__actions">
            <button
              type="button"
              className="btn btn--minus"
              disabled={busy || !stealTeamId}
              onClick={() => resolve('steal_wrong', stealTeamId!)}
            >
              ✗ Feil
            </button>
            <button
              type="button"
              className="btn btn--plus"
              disabled={busy || !stealTeamId}
              onClick={() => resolve('steal_correct', stealTeamId!)}
            >
              ✓ Riktig
            </button>
          </div>
          <button
            type="button"
            className="btn btn--undo"
            disabled={busy}
            onClick={() => resolve('no_steal')}
          >
            Ingen stjal — hele rommet drikker
          </button>
        </div>
      ) : (
        <div className="spor__actions">
          <button
            type="button"
            className="btn btn--minus"
            disabled={busy}
            onClick={() => resolve('own_wrong')}
          >
            ✗ Feil
          </button>
          <button
            type="button"
            className="btn btn--plus"
            disabled={busy}
            onClick={() => resolve('own_correct')}
          >
            ✓ Riktig
          </button>
        </div>
      )}
    </div>
  )
}
