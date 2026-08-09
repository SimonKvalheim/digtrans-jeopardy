import { useState } from 'react'
import { hostFetch } from './api.ts'

export interface WagerLimit {
  score: number
  max: number
}

/**
 * Locks a Daily Double wager from the console.
 *
 * The host types what the team shouts, because team phones are an optional
 * input layer — the console has to be able to run this alone. The server
 * clamps whatever arrives, so the quick-pick buttons are a convenience and not
 * the rule being enforced.
 */
export function WagerPanel({
  limit,
  teamName,
  code,
  onChanged,
}: {
  limit: WagerLimit
  teamName: string
  code: string
  onChanged: () => void | Promise<void>
}) {
  const [wager, setWager] = useState(String(limit.max))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lock = async () => {
    setBusy(true)
    setError(null)
    try {
      await hostFetch(`/games/${code}/wager`, {
        method: 'POST',
        body: { wager: Number(wager) },
      })
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  // Halves and the full stack — the three a team actually asks for.
  const quick = [
    Math.floor(limit.max / 4),
    Math.floor(limit.max / 2),
    limit.max,
  ].filter((n, i, all) => n > 0 && all.indexOf(n) === i)

  return (
    <div className="wager">
      <h2 className="wager__title">Dagens doble</h2>
      <p className="muted">
        {teamName} satser. Maks <strong>{limit.max}</strong>
        {limit.score <= 0
          ? ' (laget er på null eller under, så gulvet gjelder)'
          : ' — hele poengsummen'}
        .
      </p>

      <div className="wager__quick">
        {quick.map((value) => (
          <button
            key={value}
            type="button"
            className={`chip${Number(wager) === value ? ' chip--active' : ''}`}
            onClick={() => setWager(String(value))}
          >
            {value}
          </button>
        ))}
      </div>

      <input
        type="text"
        inputMode="numeric"
        value={wager}
        onChange={(e) => setWager(e.target.value.replace(/[^0-9]/g, ''))}
      />

      {error ? <p className="host__error">{error}</p> : null}

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy}
        onClick={lock}
      >
        {busy ? 'Låser…' : 'Lås innsatsen og vis spørsmålet'}
      </button>
    </div>
  )
}
