import { useCallback, useEffect, useState } from 'react'
import {
  hostFetch,
  hostSession,
  type HostGameView,
} from '../host/api.ts'
import { HostGate } from '../host/HostGate.tsx'
import { PoengTab } from '../host/PoengTab.tsx'

type Tab = 'brett' | 'spor' | 'poeng'

/**
 * The host console. One-handed, on Simon's own phone.
 *
 * Manual override is core scope, not a fallback: this surface can seat teams
 * and move every score without a single team phone connecting, which is what
 * makes a dead venue network survivable.
 */
export function HostScreen() {
  const [code, setCode] = useState(hostSession.code())
  const [view, setView] = useState<HostGameView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('poeng')

  const refresh = useCallback(async () => {
    if (!code) return
    try {
      setView(await hostFetch<HostGameView>(`/games/${code}`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    }
  }, [code])

  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, 4000)
    return () => clearInterval(timer)
  }, [refresh])

  if (!hostSession.pin() || !code) {
    return (
      <HostGate
        onReady={(nextCode) => {
          setCode(nextCode)
          void refresh()
        }}
      />
    )
  }

  return (
    <div className="phone host">
      <header className="host__header">
        <span className="host__code">{code}</span>
        {error ? <span className="host__error">{error}</span> : null}
      </header>

      <main className="host__body">
        {tab === 'poeng' && view ? (
          <PoengTab view={view} code={code} onChanged={refresh} />
        ) : null}
        {tab === 'brett' ? (
          <p className="muted">Brett-fanen kommer.</p>
        ) : null}
        {tab === 'spor' ? <p className="muted">Spør-fanen kommer.</p> : null}
        {!view && !error ? <p className="muted">Laster…</p> : null}
      </main>

      {/* Fixed where the thumb already is. */}
      <nav className="host__tabs">
        {(
          [
            ['brett', 'Brett'],
            ['spor', 'Spør'],
            ['poeng', 'Poeng'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`host__tab${tab === key ? ' host__tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
