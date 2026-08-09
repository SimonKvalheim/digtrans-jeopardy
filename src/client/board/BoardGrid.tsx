import type { BoardState } from '@shared/board-state.ts'

/**
 * The 6×5 grid. Sized by CSS grid rather than fixed pixels so that cutting
 * round 2 to four categories stays a data change with no code change — the
 * PRD's stated fallback if Monday slips.
 */
export function BoardGrid({ round }: { round: NonNullable<BoardState['round']> }) {
  const columns = round.categories.length
  const rows = rowsOf(round.categories)

  return (
    <div
      className="board__grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        // A header row plus one row per price actually present.
        gridTemplateRows: `132px repeat(${rows.length}, 1fr)`,
      }}
    >
      {round.categories.map((category) => (
        <div key={category.id} className="board__category">
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
              className={`board__tile${tile.spent ? ' board__tile--spent' : ''}`}
            >
              {tile.spent ? '' : tile.value}
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
