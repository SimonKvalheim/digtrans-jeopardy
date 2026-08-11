import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { hostFetch, hostSession, type HostGameView } from '../host/api.ts'
import { HostGate } from '../host/HostGate.tsx'
import { PoengTab } from '../host/PoengTab.tsx'
import { BrettTab } from '../host/BrettTab.tsx'
import { SporTab, type ActiveClue } from '../host/SporTab.tsx'
import type { WagerLimit } from '../host/WagerPanel.tsx'
import { FinalPanel } from '../host/FinalPanel.tsx'
import { GamePicker } from '../host/GamePicker.tsx'

type Tab = 'brett' | 'spor' | 'poeng' | 'final'

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
  const [board, setBoard] = useState<BoardState | null>(null)
  const [active, setActive] = useState<ActiveClue | null>(null)
  const [wagerLimit, setWagerLimit] = useState<WagerLimit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('brett')
  const [picking, setPicking] = useState(false)

  // Opening a tile should put the question in front of the host without a
  // second tap — that tap costs a beat every single clue.
  const hadActive = useRef(false)

  const refresh = useCallback(async () => {
    if (!code) return
    try {
      const [nextView, nextBoard, nextActive] = await Promise.all([
        hostFetch<HostGameView>(`/games/${code}`),
        hostFetch<BoardState>(`/games/${code}/board`),
        hostFetch<{ active: ActiveClue | null; wagerLimit: WagerLimit | null }>(
          `/games/${code}/active`,
        ),
      ])
      setView(nextView)
      setBoard(nextBoard)
      setActive(nextActive.active)
      setWagerLimit(nextActive.wagerLimit)
      setError(null)

      const nowActive = Boolean(nextActive.active)
      if (nowActive && !hadActive.current) setTab('spor')
      if (!nowActive && hadActive.current) setTab('brett')
      hadActive.current = nowActive
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    }
  }, [code])

  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, 3000)
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
        {/* The code is the switcher: it is already the thing the host looks at
            to check which game this phone is driving. */}
        <button
          type="button"
          className="host__code host__code--button"
          onClick={() => setPicking(true)}
        >
          {code}
          <span aria-hidden="true">▾</span>
        </button>
        {error ? <span className="host__error">{error}</span> : null}
      </header>

      {picking ? (
        <GamePicker
          current={code}
          onPick={(next) => {
            setCode(next)
            // The old game's board and open clue must not linger under the new
            // code — refresh runs on the next tick with the new code anyway,
            // but a stale board for even one frame is a wrong tile grid.
            setBoard(null)
            setView(null)
            setActive(null)
            setError(null)
            // Land on Brett, and forget the old game's open clue so the
            // auto-jump to Spør fires on the next real tile rather than on
            // whatever the game being left happened to have open.
            setTab('brett')
            hadActive.current = false
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      <main className="host__body">
        {tab === 'brett' && board ? (
          <BrettTab board={board} code={code} onChanged={refresh} />
        ) : null}
        {tab === 'spor' && board ? (
          <SporTab
            active={active}
            wagerLimit={wagerLimit}
            board={board}
            code={code}
            onChanged={refresh}
          />
        ) : null}
        {tab === 'poeng' && view ? (
          <PoengTab view={view} code={code} onChanged={refresh} />
        ) : null}
        {tab === 'final' ? <FinalPanel code={code} onChanged={refresh} /> : null}
        {!board && !error ? <p className="muted">Laster…</p> : null}
      </main>

      {/* Fixed where the thumb already is. */}
      <nav className="host__tabs">
        {(
          [
            ['brett', 'Brett'],
            ['spor', 'Spør'],
            ['poeng', 'Poeng'],
            ['final', 'Final'],
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
