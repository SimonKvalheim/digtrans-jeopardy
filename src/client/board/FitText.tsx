import { useLayoutEffect, useRef } from 'react'

/**
 * Shrinks text until it fits its box.
 *
 * The board is a fixed 1920×1080 stage with no scrollbar and `overflow: hidden`
 * on the clue, so a prompt that is too big is not merely ugly — it is silently
 * cut off in front of the room. The real pack's longest prompt is 207
 * characters against a test pack's 11, so this cannot be left to eyeballing one
 * example.
 *
 * Fit is decided by comparing the *text's own* bounding box against the
 * container's content box, never by scrollHeight: this text is centred, and a
 * centred box sheds its overflow upward as well as downward — scrollHeight
 * reports only the downward half, which is exactly how this project's last
 * overflow bug hid for a whole evening.
 */
export function FitText({
  text,
  className,
  max,
  min,
  step = 4,
}: {
  text: string
  className?: string
  max: number
  min: number
  step?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const span = textRef.current
    if (!box || !span) return

    const style = getComputedStyle(box)
    const availableHeight =
      box.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom)
    const availableWidth =
      box.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)

    // A container with no height yet (first paint of a hidden branch) would
    // otherwise shrink everything to the floor for no reason.
    if (availableHeight <= 0 || availableWidth <= 0) return

    const fits = () => {
      const rect = span.getBoundingClientRect()
      const scale = box.getBoundingClientRect().width / box.clientWidth || 1
      return (
        rect.height / scale <= availableHeight + 0.5 &&
        rect.width / scale <= availableWidth + 0.5
      )
    }

    let size = max
    box.style.fontSize = `${size}px`
    while (size > min && !fits()) {
      size -= step
      box.style.fontSize = `${size}px`
    }
  }, [text, max, min, step])

  return (
    <div ref={boxRef} className={className}>
      <span ref={textRef}>{text}</span>
    </div>
  )
}
