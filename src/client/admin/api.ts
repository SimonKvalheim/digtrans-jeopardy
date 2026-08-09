const PIN_KEY = 'jeopardy.adminPin'

/** Same shape as the host session, and deliberately a different key: the two
 *  PINs are different secrets and one surface should never authenticate the
 *  other by accident. */
export const adminSession = {
  pin: () => localStorage.getItem(PIN_KEY) ?? '',
  setPin: (pin: string) => localStorage.setItem(PIN_KEY, pin),
  clear: () => localStorage.removeItem(PIN_KEY),
}

export interface AdminProblem {
  path: string
  message: string
}

export class AdminError extends Error {
  problems: AdminProblem[]
  constructor(message: string, problems: AdminProblem[] = []) {
    super(message)
    this.problems = problems
  }
}

export async function adminFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-pin': adminSession.pin(),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new AdminError(
      typeof data?.error === 'string' ? data.error : `Feil (${res.status})`,
      Array.isArray(data?.problems) ? data.problems : [],
    )
  }
  return data as T
}

/**
 * Fetches a clue's image as an object URL.
 *
 * An `<img src>` cannot carry the PIN header, and the public /api/media route
 * is keyed by game_clues.id — the per-night row — which the editor does not
 * have and should not need. So the bytes come back through the same
 * authenticated path as everything else and get wrapped in a blob.
 */
export async function fetchClueImage(clueId: string): Promise<string | null> {
  const res = await fetch(`/api/admin/clues/${clueId}/image`, {
    headers: { 'x-pin': adminSession.pin() },
  })
  if (!res.ok) return null
  return URL.createObjectURL(await res.blob())
}

export interface AdminClue {
  id: string
  tier: number
  answer: string
  fromLabel: string | null
  kind: string
  payload: { kind: string; prompt: string; link?: string; hint?: string }
  hasImage: boolean
  imageMime: string | null
}

export interface AdminCategory {
  id: string
  name: string
  pairedWith: string | null
  position: number
  clues: AdminClue[]
}

export interface AdminRound {
  id: string
  kind: 'jeopardy' | 'double' | 'final'
  position: number
  valueStep: number
  dailyDoubles: number
  categories: AdminCategory[]
}

export interface AdminPack {
  id: string
  slug: string
  title: string
  publishedAt: string | null
}

export interface AdminGame {
  id: string
  code: string
  phase: string
  createdAt: string
  packSlug: string
}

/**
 * What still blocks publishing, computed on the client purely so the list can
 * be shown before the server is asked. The server re-runs the real rules; this
 * is a hint, never the decision.
 */
export function missingImage(clue: AdminClue): boolean {
  return clue.kind === 'image' && !clue.hasImage
}
