import { useEffect, useRef, type CSSProperties } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import { clueImageUrl } from '../clue-kinds.tsx'
import { rememberTileRects, SETTLE_MS, whenSettled } from './tile-rects.ts'

/**
 * The 6×5 grid. Sized by CSS grid rather than fixed pixels so that cutting
 * round 2 to four categories stays a data change with no code change — the
 * PRD's stated fallback if Monday slips.
 */
export function BoardGrid({ round }: { round: NonNullable<BoardState['round']> }) {
  const columns = round.categories.length
  const rows = rowsOf(round.categories)

  const imageTiles = round.categories
    .flatMap((category) => category.tiles)
    .filter((tile) => tile.hasImage && !tile.spent)
    .map((tile) => tile.id)

  // Warm every picture in the round while the grid is on screen. A tile opening
  // is the one moment in the evening with an audience and no patience, and a
  // photo that starts downloading then is a blank blue rectangle in front of
  // thirty people. The grid is on screen for minutes before that happens.
  useEffect(() => {
    imageTiles.forEach(warmImage)
    // Deliberately no cleanup: this grid unmounts the moment a tile opens, and
    // aborting the very downloads that were meant to be ready by then would
    // defeat the point entirely.
  }, [imageTiles.join()])

  // Tile positions, for the zoom the clue does out of the tile that was picked.
  const tileEls = useRef(new Map<string, HTMLElement>())
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const snap = () => rememberTileRects(tileEls.current)

    // After the cascade lands, not on a wall-clock guess — a background tab
    // freezes the timeline and a timer would then measure every tile at 86% of
    // its real size. The timer stays only as a floor for the reduced-motion
    // case, where there is no animation to wait on at all.
    if (gridRef.current) void whenSettled(gridRef.current).then(snap)
    const timer = setTimeout(snap, SETTLE_MS)

    window.addEventListener('resize', snap)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', snap)
    }
  }, [round.id])

  return (
    <div
      ref={gridRef}
      className="board__grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        // A header row plus one row per price actually present.
        gridTemplateRows: `132px repeat(${rows.length}, 1fr)`,
      }}
    >
      {round.categories.map((category, columnIndex) => (
        <div
          key={category.id}
          className="board__category"
          style={{ '--jp-in': `${columnIndex * 45}ms` } as CSSProperties}
        >
          <span>{category.name}</span>
          {category.pairedWith ? (
            <em className="board__category-pair">/ {category.pairedWith}</em>
          ) : null}
        </div>
      ))}

      {/* The grid fills row by row, so tiles are emitted tier by tier across
          all categories rather than category by category. */}
      {rows.map((row, rowIndex) =>
        row.map((tile, columnIndex) =>
          tile ? (
            <div
              key={tile.id}
              ref={(el) => {
                if (el) tileEls.current.set(tile.id, el)
                else tileEls.current.delete(tile.id)
              }}
              className={`board__tile${tile.spent ? ' board__tile--spent' : ''}`}
              // Diagonal stagger, so a new round lands as one sweep across the
              // board rather than six columns arriving at once.
              style={
                {
                  '--jp-in': `${(rowIndex + columnIndex) * 45 + 120}ms`,
                } as CSSProperties
              }
            >
              {tile.spent ? null : (
                <>
                  <span className="board__tile-value">{tile.value}</span>
                  {/* The buy-in is on the tile, not just on the open clue, so a
                      team knows what attempting costs before it picks. The app
                      displays sips and never tracks or enforces them. */}
                  <span className="board__tile-sips">{tile.sips} slurker</span>
                </>
              )}
            </div>
          ) : (
            // A price this category simply does not have. Left blank rather
            // than greyed, so it does not read as an already-played tile.
            <div
              key={`gap-${rowIndex}-${columnIndex}`}
              className="board__tile board__tile--empty"
            />
          ),
        ),
      )}
    </div>
  )
}

/**
 * Held outside the component, and never released: an Image whose only reference
 * is a local can have its in-flight request dropped, and the whole purpose here
 * is that the request finishes after the component is gone. At most a handful
 * of photos per round, so nothing to reclaim.
 */
const warmedImages = new Map<string, HTMLImageElement>()

function warmImage(gameClueId: string) {
  if (warmedImages.has(gameClueId)) return
  const img = new Image()
  img.src = clueImageUrl(gameClueId)
  warmedImages.set(gameClueId, img)
}

/**
 * Transposes categories-of-tiles into rows-of-tiles, keyed by **tier** rather
 * than by array position.
 *
 * This matters: indexing by position means a category missing one tier pulls
 * every tile below it up a row, so the 300s stop lining up across the board.
 * A row is a price, so a category without that price leaves a hole.
 */
function rowsOf(categories: NonNullable<BoardState['round']>['categories']) {
  const maxTier = Math.max(
    ...categories.flatMap((c) => c.tiles.map((t) => t.tier)),
    0,
  )

  return Array.from({ length: maxTier }, (_, rowIndex) => {
    const tier = rowIndex + 1
    return categories.map(
      (category) => category.tiles.find((t) => t.tier === tier) ?? null,
    )
  })
}
