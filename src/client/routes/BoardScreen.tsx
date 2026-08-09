import { Stage } from '../Stage.tsx'

export function BoardScreen() {
  return (
    <Stage>
      <div style={{ padding: 96 }}>
        <h1 style={{ fontSize: 120, color: 'var(--gold-bright)' }}>Jeopardy</h1>
        <p style={{ fontSize: 40 }} className="muted">
          Brettet er koblet til. Venter på spill.
        </p>
      </div>
    </Stage>
  )
}
