import { useCallback, useEffect, useState } from 'react'
import { teamSession } from './session.ts'

interface TeamFinal {
  phase: string
  playing: boolean
  maxWager: number
  mine: {
    wagerLocked: boolean
    answerLocked: boolean
    wager: number | null
    verdict: string | null
  } | null
}

/**
 * The Final on a team phone: a number, then a sentence. Never the clue text —
 * that is on the TV, which is the whole reason heads stay up.
 *
 * Both are one-way: once locked, the phone cannot change them. A blind wager
 * that can be edited after the question appears is not a blind wager.
 */
export function FinalScreen({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<TeamFinal | null>(null)
  const [wager, setWager] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/team/final', {
      headers: { 'x-join-token': teamSession.token() },
    })
    if (res.ok) setState((await res.json()) as TeamFinal)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, 2500)
    return () => clearInterval(timer)
  }, [refresh])

  const post = async (path: string, body: unknown) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/team/final/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-join-token': teamSession.token(),
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Ukjent feil')
      await refresh()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  if (!state) return <p className="muted">Laster…</p>

  if (!state.playing) {
    return (
      <div className="team__idle">
        <h1 className="team__won">Ute av finalen</h1>
        <p className="muted">
          Null eller under. Se på skjermen — og drikk med de andre.
        </p>
      </div>
    )
  }

  const mine = state.mine

  if (state.phase === 'final_wager') {
    return mine?.wagerLocked ? (
      <div className="team__idle">
        <h1 className="team__won">{mine.wager}</h1>
        <p className="muted">Innsatsen er låst. Se på skjermen.</p>
      </div>
    ) : (
      <div className="team-final">
        <h1>Satse blindt</h1>
        <p className="muted">
          Ingen kategori, ingen hint. 0 til {state.maxWager}.
        </p>
        <input
          type="text"
          inputMode="numeric"
          value={wager}
          placeholder="0"
          onChange={(e) => setWager(e.target.value.replace(/[^0-9]/g, ''))}
        />
        {error ? <p className="host__error">{error}</p> : null}
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || wager === ''}
          onClick={() => post('wager', { wager: Number(wager) })}
        >
          Lås innsatsen
        </button>
      </div>
    )
  }

  if (state.phase === 'final_clue') {
    return mine?.answerLocked ? (
      <div className="team__idle">
        <h1 className="team__won">Svaret er låst</h1>
        <p className="muted">Se på skjermen.</p>
      </div>
    ) : (
      <div className="team-final">
        <h1>Svaret</h1>
        <p className="muted">Spørsmålet står på skjermen.</p>
        <input
          type="text"
          value={answer}
          placeholder="Skriv svaret"
          onChange={(e) => setAnswer(e.target.value)}
        />
        {error ? <p className="host__error">{error}</p> : null}
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || answer.trim() === ''}
          onClick={() => post('answer', { answer: answer.trim() })}
        >
          Lås svaret
        </button>
      </div>
    )
  }

  return (
    <div className="team__idle">
      <h1 className="team__won">
        {mine?.verdict === 'correct'
          ? `+${mine.wager}`
          : mine?.verdict === 'wrong'
            ? `−${mine.wager}`
            : '…'}
      </h1>
      <p className="muted">Se på skjermen.</p>
    </div>
  )
}
