/**
 * The studio set: valance, columns, walls, floor. Pure decoration — no props,
 * no state, never re-renders, and nothing inside it is ever read by the game.
 *
 * It is CSS-only on purpose. A real photographic set would have to be licensed,
 * shipped, and colour-matched to the tiles; this version costs nothing, scales
 * with the 1920×1080 stage, and stays readable when a projector crushes the
 * blacks.
 *
 * Visibility is owned by `.stage--scene` / `.stage--plain` on the parent, so
 * the host's toggle cross-fades the whole set with one class change.
 */
export function StudioScene() {
  return (
    <div className="studio" aria-hidden="true">
      {/* Ceiling: a ribbed valance rotated in 3D so the ribs converge toward
          the back of the room, fading into darkness at the far end. */}
      <div className="studio__ceiling">
        <div className="studio__ceiling-plane" />
        <div className="studio__ceiling-fade" />
        <div className="studio__ceiling-lip" />
      </div>

      <div className="studio__led" />
      <div className="studio__led-spill" />

      {/* Side walls, angled away from the camera. */}
      <div className="studio__wall studio__wall--left" />
      <div className="studio__wall studio__wall--right" />
      <div className="studio__rail studio__rail--left" />
      <div className="studio__rail studio__rail--right" />
      <div className="studio__rail studio__rail--left-low" />
      <div className="studio__rail studio__rail--right-low" />

      <Column side="left" />
      <Column side="right" />

      <div className="studio__floor">
        <div className="studio__floor-grid" />
        <div className="studio__floor-bounce" />
        <div className="studio__glow studio__glow--1" />
        <div className="studio__glow studio__glow--2" />
        <div className="studio__glow studio__glow--3" />
      </div>
    </div>
  )
}

/**
 * A Roman column, bottom-lit. The profile is the classical one — abacus,
 * echinus and necking on top; astragal, torus and plinth at the base — around a
 * fluted shaft that carries the set's cyan practical light.
 */
function Column({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`studio__column studio__column--${side}`}>
      <div className="studio__abacus" />
      <div className="studio__echinus" />
      <div className="studio__necking" />
      <div className="studio__shaft" />
      <div className="studio__shaft-shade" />
      <div className="studio__astragal" />
      <div className="studio__torus" />
      <div className="studio__plinth" />
    </div>
  )
}
