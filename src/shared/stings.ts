/**
 * The canonical set of sounds the room can hear (PRD §8.3).
 *
 * Shared rather than declared in the board, because three surfaces now need to
 * agree on it: the board plays them, the admin routes accept uploads for them,
 * and the generation script names its files after them. A generated clip filed
 * under a name nothing plays is silent with no error, so the list lives in one
 * place and everything else is checked against it.
 */
export const STING_NAMES = [
  'tileOpen',
  'buzz',
  'correct',
  'wrong',
  'tick',
  'timeUp',
  'dailyDouble',
  'roundStart',
  'final',
  'winner',
  'stumper',
] as const

export type StingName = (typeof STING_NAMES)[number]

export function isStingName(value: string): value is StingName {
  return (STING_NAMES as readonly string[]).includes(value)
}
