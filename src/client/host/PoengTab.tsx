import { useState } from 'react'
import { hostFetch, type HostGameView } from './api.ts'

const STEPS = [50, 100, 200, 400]

/**
 * Every team's score with ± steppers, a configurable step, and undo.
 *
 * This is the tab that makes the console self-sufficient: with it alone the
 * whole game can be run by hand while the phones do nothing.
 */
export function PoengTab({
  view,
  code,
  onChanged,
}: {
  view: HostGameView
  code: string
  onChanged: () => void | Promise<void>
}) {
  const [step, setStep] = useState(100)
  const [newTeam, setNewTeam] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
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

  const adjust = (teamId: string, delta: number) =>
    run(() =>
      hostFetch(`/games/${code}/score`, {
        method: 'POST',
        body: { teamId, delta },
      }),
    )

  const addTeam = (event: React.FormEvent) => {
    event.preventDefault()
    const name = newTeam.trim()
    if (!name) return
    setNewTeam('')
    return run(() =>
      hostFetch(`/games/${code}/teams`, { method: 'POST', body: { name } }),
    )
  }

  const lastUndoable = view.recentEvents.find((e) => !e.undone)

  return (
    <div className="poeng">
      <div className="poeng__steps">
        {STEPS.map((value) => (
          <button
            key={value}
            type="button"
            className={`chip${step === value ? ' chip--active' : ''}`}
            onClick={() => setStep(value)}
          >
            {value}
          </button>
        ))}
      </div>

      {view.teams.length === 0 ? (
        <p className="muted">Ingen lag ennå. Legg dem til nedenfor.</p>
      ) : null}

      <ul className="poeng__teams">
        {view.teams.map((team) => (
          <li key={team.id} className="poeng__team">
            <div className="poeng__team-head">
              <span className="poeng__team-name">{team.name}</span>
              <span
                className={`poeng__team-score${
                  team.score < 0 ? ' poeng__team-score--negative' : ''
                }`}
              >
                {team.score}
              </span>
            </div>
            <div className="poeng__team-controls">
              <button
                type="button"
                className="btn btn--minus"
                disabled={busy}
                onClick={() => adjust(team.id, -step)}
              >
                −{step}
              </button>
              <button
                type="button"
                className="btn btn--plus"
                disabled={busy}
                onClick={() => adjust(team.id, step)}
              >
                +{step}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className="poeng__add" onSubmit={addTeam}>
        <input
          type="text"
          placeholder="Nytt lag"
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy}>
          Legg til
        </button>
      </form>

      <button
        type="button"
        className="btn btn--undo"
        disabled={busy || !lastUndoable}
        onClick={() =>
          run(() => hostFetch(`/games/${code}/undo`, { method: 'POST' }))
        }
      >
        ↶ Angre
        {lastUndoable
          ? ` (${lastUndoable.delta > 0 ? '+' : ''}${lastUndoable.delta})`
          : ''}
      </button>

      {error ? <p className="host__error">{error}</p> : null}
    </div>
  )
}
