import { useCallback, useEffect, useState } from 'react'
import { fetchMe, teamSession, type TeamMe } from '../team/session.ts'
import { useGameSocket } from '../team/useGameSocket.ts'
import { JoinForm } from '../team/JoinForm.tsx'
import { BuzzButton } from '../team/BuzzButton.tsx'
import { FinalScreen } from '../team/FinalScreen.tsx'

/**
 * The team phone. Deliberately almost empty — from the tape: "vi ville helst at
 * folk ikke skal sitte på mobilen."
 *
 * It never shows clue text. That is on the TV, and it is what keeps heads up.
 */
export function TeamScreen() {
  const [me, setMe] = useState<TeamMe | null>(null)
  const [ready, setReady] = useState(false)
  const [buzzFeedback, setBuzzFeedback] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setMe(await fetchMe())
    setReady(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const { status, send } = useGameSocket({
    role: 'team',
    gameId: me?.game.id,
    teamId: me?.team.id,
    onMessage: (msg) => {
      if (msg.type === 'changed') {
        setBuzzFeedback(null)
        void refresh()
      }
      if (msg.type === 'buzz_result') {
        setBuzzFeedback(
          msg.won ? 'Du var først!' : `${msg.marginMs} ms for sent`,
        )
        void refresh()
      }
      if (msg.type === 'buzz_rejected') setBuzzFeedback('For sent')
    },
  })

  // A locked phone drops its socket; poll slowly as a safety net so a team is
  // never stranded on a stale screen if a push is missed.
  useEffect(() => {
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  if (!ready) {
    return (
      <div className="phone">
        <div className="phone__body">
          <p className="muted">Laster…</p>
        </div>
      </div>
    )
  }

  if (!me) {
    return <JoinForm onJoined={refresh} />
  }

  const won = me.stealWinnerTeamId === me.team.id

  return (
    <div className="phone team">
      <header className="team__header">
        <span className="team__name">{me.team.name}</span>
        <span className={`team__score${me.team.score < 0 ? ' team__score--neg' : ''}`}>
          {me.team.score}
        </span>
      </header>

      <main className="team__body">
        {me.phase.startsWith('final') ? (
          <FinalScreen onChanged={refresh} />
        ) : me.canBuzz ? (
          <BuzzButton
            onBuzz={() => {
              // Vibration is the only feedback that survives a loud room.
              navigator.vibrate?.(60)
              if (!send({ type: 'buzz' })) {
                setBuzzFeedback('Ingen forbindelse')
              }
            }}
            feedback={buzzFeedback}
          />
        ) : won ? (
          <div className="team__idle">
            <h1 className="team__won">Du vant!</h1>
            <p className="muted">Svar høyt.</p>
          </div>
        ) : (
          <div className="team__idle">
            <p className="muted">Se på skjermen.</p>
            {buzzFeedback ? <p className="team__feedback">{buzzFeedback}</p> : null}
          </div>
        )}
      </main>

      <footer className="team__footer">
        <span className={`team__status team__status--${status}`}>
          {status === 'open'
            ? 'Tilkoblet'
            : status === 'connecting'
              ? 'Kobler til…'
              : 'Frakoblet — prøver igjen'}
        </span>
        <button
          type="button"
          className="team__leave"
          onClick={() => {
            teamSession.clear()
            setMe(null)
          }}
        >
          Bytt lag
        </button>
      </footer>
    </div>
  )
}
