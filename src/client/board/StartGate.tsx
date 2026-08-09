import { useEffect } from 'react'

/**
 * "Trykk for å starte" — the one interaction the TV is allowed to need
 * (PRD §8.1). It unlocks audio and goes fullscreen in the same gesture.
 *
 * Two shapes on purpose. In the lobby it is the whole screen, because that is
 * the moment someone is standing at the laptop anyway. Once the game is running
 * it shrinks to a strip along the bottom: a board reloaded mid-evening — the
 * lid closed, a redeploy — must come back showing the game, not a modal
 * covering it, and the PRD is explicit that the board survives a reload with no
 * input at all. Sound is the only thing waiting on the tap.
 */
export function StartGate({
  compact,
  onStart,
}: {
  compact: boolean
  onStart: () => void
}) {
  // A keypress is a user gesture too, and the laptop driving the TV may be
  // easier to reach by keyboard than by trackpad once it is behind the screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') return
      onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart])

  return (
    <button
      type="button"
      className={`start-gate${compact ? ' start-gate--compact' : ''}`}
      onClick={onStart}
    >
      {compact ? (
        <span className="start-gate__compact-text">
          Trykk for lyd og fullskjerm
        </span>
      ) : (
        <>
          <span className="start-gate__title">Trykk for å starte</span>
          <span className="start-gate__sub">Lyd og fullskjerm</span>
        </>
      )}
    </button>
  )
}
