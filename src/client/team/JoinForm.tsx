import { useState } from 'react'
import { teamSession } from './session.ts'

/**
 * Room code, team name, and one sentence defending the name.
 *
 * The pitch is not decoration — it goes to the name judging at the intro, and
 * it is the first thing that makes a table of strangers talk to each other.
 */
export function JoinForm({ onJoined }: { onJoined: () => void | Promise<void> }) {
  const [code, setCode] = useState(
    new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? '',
  )
  const [name, setName] = useState('')
  const [pitch, setPitch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/team/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, pitch: pitch || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Kunne ikke bli med')
      teamSession.setToken(data.joinToken)
      await onJoined()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="phone">
      <form className="phone__body host-gate" onSubmit={submit}>
        <h1>Bli med</h1>

        <label className="field">
          <span>Romkode</span>
          <input
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>

        <label className="field">
          <span>Lagnavn</span>
          <input
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Forsvar navnet i én setning</span>
          <input
            type="text"
            autoComplete="off"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
          />
        </label>

        {error ? <p className="host__error">{error}</p> : null}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Blir med…' : 'Bli med'}
        </button>
      </form>
    </div>
  )
}
