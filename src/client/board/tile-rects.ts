/**
 * Where each tile sits on screen, so an opening clue can grow out of the tile
 * that was picked rather than simply replacing the board (PRD §8.4).
 *
 * Module-level on purpose: the grid is unmounted by the time the clue needs
 * this, so the measurement cannot live in either component's state.
 */

const rects = new Map<string, DOMRect>()

/** Fallback only, for when there are no entrance animations to wait on. */
export const SETTLE_MS = 1200

/**
 * The name of the entrance animation, so the snapshot can wait for exactly
 * those to finish and ignore the tiles' endless specular sweep — whose
 * `finished` promise, being infinite, never resolves.
 */
const ENTRANCE = 'jp-tilein'

/**
 * Resolves once the entrance cascade has actually finished.
 *
 * A timer was wrong: a hidden tab freezes the document timeline, so the
 * animations sit at their first keyframe indefinitely and a wall-clock
 * measurement records every tile at 86% of its real size, in a position no
 * tile was ever in. Waiting on the animations themselves is correct whether
 * the board is on screen or in a background tab.
 */
export function whenSettled(root: Element): Promise<void> {
  const entrances = root
    .getAnimations({ subtree: true })
    .filter((a) => (a as CSSAnimation).animationName === ENTRANCE)

  if (entrances.length === 0) return Promise.resolve()
  return Promise.all(entrances.map((a) => a.finished)).then(() => undefined)
}

export function rememberTileRects(entries: Map<string, HTMLElement>) {
  for (const [id, el] of entries) rects.set(id, el.getBoundingClientRect())
}

export function tileRect(id: string): DOMRect | undefined {
  return rects.get(id)
}

/**
 * The board is drawn at a fixed 1920×1080 and scaled to whatever the TV is, so
 * a pixel offset measured in viewport space has to be divided by that scale
 * before it can be used inside the stage's own coordinate system.
 */
export function stageScale(): number {
  const stage = document.querySelector('.stage')
  if (!stage) return 1
  const width = stage.getBoundingClientRect().width
  return width > 0 ? width / 1920 : 1
}
