import { useCallback, useEffect, useState } from 'react'
import { hostFetch } from './api.ts'
import type { FinalBet } from '../board/FinalView.tsx'

interface HostFinalState {
  phase: string
  prompt: string | null
  answerKey: string | null
  bets: FinalBet[]
}

/**
 * Runs the Final from the console.
 *
 * Deliberately linear — start, reveal, collect, judge, finish — because this
 * happens once, at the loudest point of the evening, and a screen with choices
 * on it is a screen you can get wrong.
 */
export function FinalPanel({
  code,
  onChanged,
}: {
  code: string
  onChanged: () => void | Promise<void>
}) {
  const [state, setState] = useState<HostFinalState | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await hostFetch<HostFinalState>(`/games/${code}/final`))
    } catch {
      setState(null)
    }
  }, [code])

  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  const act = async (path: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    try {
      await hostFetch(`/games/${code}/final/${path}`, { method: 'POST', body })
      await Promise.all([refresh(), onChanged()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  const phase = state?.phase ?? ''
  const inFinal = phase.startsWith('final')

  if (!inFinal) {
    return (
      <div className="final-panel">
        <p className="muted">
          Alle lag på null eller under står over finalen.
        </p>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => act('start')}
        >
          Start Final Jeopardy
        </button>
        {error ? <p className="host__error">{error}</p> : null}
      </div>
    )
  }

  const wagersIn = state!.bets.filter((b) => b.wagerLocked).length
  const answersIn = state!.bets.filter((b) => b.answerLocked).length

  return (
    <div className="final-panel">
      <h2 className="wager__title">Final Jeopardy</h2>

      {phase === 'final_wager' ? (
        <>
          <p className="muted">
            {wagersIn} av {state!.bets.length} har låst innsats.
          </p>
          <ul className="final-panel__list">
            {state!.bets.map((b) => (
              <li key={b.teamId}>
                <span>{b.teamName}</span>
                <strong>{b.wagerLocked ? `${b.wager}` : '—'}</strong>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => act('reveal')}
          >
            Vis spørsmålet {wagersIn < state!.bets.length ? '(noen mangler)' : ''}
          </button>
        </>
      ) : null}

      {phase === 'final_clue' ? (
        <>
          <p className="spor__prompt">{state!.prompt}</p>
          {showKey ? (
            <p className="spor__answer">{state!.answerKey}</p>
          ) : (
            <button type="button" className="btn" onClick={() => setShowKey(true)}>
              Vis fasit
            </button>
          )}
          <p className="muted">
            {answersIn} av {state!.bets.length} har svart.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => act('collect')}
          >
            Lukk svarene og vis dem
          </button>
        </>
      ) : null}

      {phase === 'final_reveal' ? (
        <>
          <p className="spor__answer">{state!.answerKey}</p>
          <ul className="final-panel__judge">
            {state!.bets.map((b) => (
              <li key={b.teamId}>
                <div className="final-panel__judge-head">
                  <span>{b.teamName}</span>
                  <strong>{b.wager}</strong>
                </div>
                <p className="final-panel__answer">
                  {b.answer ?? <em>intet svar</em>}
                </p>
                {b.verdict ? (
                  <p className={`final-panel__verdict final-panel__verdict--${b.verdict}`}>
                    {b.verdict === 'correct' ? '✓ Riktig' : '✗ Feil'}
                  </p>
                ) : (
                  <div className="spor__actions">
                    <button
                      type="button"
                      className="btn btn--minus"
                      disabled={busy}
                      onClick={() => act('judge', { teamId: b.teamId, correct: false })}
                    >
                      ✗ Feil
                    </button>
                    <button
                      type="button"
                      className="btn btn--plus"
                      disabled={busy}
                      onClick={() => act('judge', { teamId: b.teamId, correct: true })}
                    >
                      ✓ Riktig
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || state!.bets.some((b) => !b.verdict)}
            onClick={() => act('finish')}
          >
            Vis sluttstillingen
          </button>
        </>
      ) : null}

      {phase === 'final_done' ? (
        <p className="muted">Finalen er ferdig. Stillingen står på skjermen.</p>
      ) : null}

      {error ? <p className="host__error">{error}</p> : null}
    </div>
  )
}
