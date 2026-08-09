import { useState } from 'react'
import { hostFetch, hostSession } from './api.ts'

/**
 * PIN plus room code, typed once per device. On a public Railway URL /host is
 * otherwise one guess away from a room full of students who would enjoy seeing
 * the answers.
 */
export function HostGate({ onReady }: { onReady: (code: string) => void }) {
  const [pin, setPin] = useState(hostSession.pin())
  const [code, setCode] = useState(hostSession.code())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    hostSession.setPin(pin)
    try {
      await hostFetch('/session', { method: 'POST' })
      const upper = code.toUpperCase()
      hostSession.setCode(upper)
      onReady(upper)
    } catch (err) {
      hostSession.clearPin()
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="phone">
      <form className="phone__body host-gate" onSubmit={submit}>
        <h1>Vertspult</h1>

        <label className="field">
          <span>PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>

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

        {error ? <p className="host__error">{error}</p> : null}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Sjekker…' : 'Åpne pulten'}
        </button>
      </form>
    </div>
  )
}
