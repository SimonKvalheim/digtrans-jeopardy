import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * A QR rendered as inline SVG, generated in the browser.
 *
 * Not a third-party image service: those are a network dependency on the one
 * screen that has to work in a room with thirty phones on the wifi, and the URL
 * would leak the room code to whoever runs the service. `qrcode-generator` is a
 * single MIT file with no dependencies of its own, which is about as boring as
 * a dependency gets.
 */
export function QrCode({
  value,
  size,
  className,
}: {
  value: string
  size: number
  className?: string
}) {
  const path = useMemo(() => {
    // Level M survives a phone camera at an angle across a room, which is the
    // only condition this will ever be read under. Type 0 auto-sizes.
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()

    const count = qr.getModuleCount()
    const parts: string[] = []
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`)
      }
    }
    return { d: parts.join(''), count }
  }, [value])

  // The quiet zone is part of the spec, not padding: without four clear modules
  // around it, plenty of scanners simply refuse to see the code.
  const quiet = 4
  const span = path.count + quiet * 2

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={`QR-kode til ${value}`}
    >
      <rect width={span} height={span} fill="#ffffff" />
      <g transform={`translate(${quiet} ${quiet})`} fill="#04072e">
        <path d={path.d} />
      </g>
    </svg>
  )
}
