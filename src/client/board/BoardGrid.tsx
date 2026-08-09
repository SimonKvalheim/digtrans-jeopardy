import type { BoardState } from '@shared/board-state.ts'

/**
 * The 6×5 grid. Sized by CSS grid rather than fixed pixels so that cutting
 * round 2 to four categories stays a data change with no code change — the
 * PRD's stated fallback if Monday slips.
 */
export function BoardGrid({ round }: { round: NonNullable<BoardState['round']> }) {
  const columns = round.categories.length

  return (
    <div
      className="board__grid"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {round.categories.map((category) => (
        <div key={category.id} className="board__category">
          <span>{category.name}</span>
          {category.pairedWith ? (
            <em className="board__category-pair">/ {category.pairedWith}</em>
          ) : null}
        </div>
      ))}

      {/* Column-major would read wrong: the grid fills row by row, so tiles are
          emitted tier by tier across all categories. */}
      {rowsOf(round.categories).map((row, tierIndex) =>
        row.map((tile, columnIndex) =>
          tile ? (
            <div
              key={tile.id}
              className={`board__tile${tile.spent ? ' board__tile--spent' : ''}`}
            >
              {tile.spent ? '' : tile.value}
            </div>
          ) : (
            <div
              key={`gap-${tierIndex}-${columnIndex}`}
              className="board__tile board__tile--spent"
            />
          ),
        ),
      )}
    </div>
  )
}

/**
 * Transposes categories-of-tiles into rows-of-tiles, padding short categories
 * so a category with a missing tier does not shift every tile after it.
 */
function rowsOf(categories: NonNullable<BoardState['round']>['categories']) {
  const height = Math.max(...categories.map((c) => c.tiles.length), 0)
  return Array.from({ length: height }, (_, tierIndex) =>
    categories.map((category) => category.tiles[tierIndex] ?? null),
  )
}
