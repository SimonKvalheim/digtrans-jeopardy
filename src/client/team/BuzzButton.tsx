/**
 * One enormous button. It fills the screen because the phone is being held at
 * waist height in a loud room by someone looking at a TV.
 *
 * `onPointerDown` rather than `onClick`: a click waits for the release, and
 * that delay is real against a 250 ms human reaction time.
 */
export function BuzzButton({
  onBuzz,
  feedback,
}: {
  onBuzz: () => void
  feedback: string | null
}) {
  return (
    <div className="buzz">
      <button
        type="button"
        className="buzz__button"
        onPointerDown={(e) => {
          e.preventDefault()
          onBuzz()
        }}
      >
        BUZZ
      </button>
      <p className="buzz__cost">
        {feedback ?? 'Feil svar koster full pott.'}
      </p>
    </div>
  )
}
