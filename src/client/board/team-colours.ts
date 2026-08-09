/**
 * One colour per seat, used only where a team has to be identified *without*
 * being read — the screen flash when a buzz lands (PRD §8.4).
 *
 * Deliberately not applied to the score strip or the tiles: the board is
 * Jeopardy blue and gold, and five more colours competing with that would make
 * it look like a different game. Seat order is stable for the whole evening, so
 * a team's flash colour never changes under it.
 */
const ACCENTS = [
  '#ff5a5a', // red
  '#3ddc84', // green
  '#4aa8ff', // blue
  '#ff9f1c', // orange
  '#c77dff', // violet
]

export function teamAccent(seat: number | undefined): string {
  if (seat === undefined) return 'var(--gold-bright)'
  return ACCENTS[seat % ACCENTS.length]!
}
