const PIN_KEY = 'jeopardy.hostPin'
const CODE_KEY = 'jeopardy.hostCode'

/**
 * The host PIN is typed once and kept in localStorage (PRD §3.1). Simon's phone
 * will lock and unlock all evening; retyping a PIN each time is exactly the
 * friction that makes a console unusable one-handed.
 */
export const hostSession = {
  pin: () => localStorage.getItem(PIN_KEY) ?? '',
  setPin: (pin: string) => localStorage.setItem(PIN_KEY, pin),
  clearPin: () => localStorage.removeItem(PIN_KEY),
  code: () => localStorage.getItem(CODE_KEY) ?? '',
  setCode: (code: string) => localStorage.setItem(CODE_KEY, code.toUpperCase()),
}

export class ApiError extends Error {}

export async function hostFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`/api/host${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-pin': hostSession.pin(),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(
      typeof data?.error === 'string' ? data.error : `Feil (${res.status})`,
    )
  }
  return data as T
}

export interface HostTeam {
  id: string
  name: string
  pitch: string | null
  score: number
  seat: number
}

export interface HostScoreEvent {
  id: string
  teamId: string
  kind: string
  delta: number
  note: string | null
  undone: boolean
  createdAt: string
}

export interface HostGameView {
  game: { id: string; code: string; phase: string }
  teams: HostTeam[]
  recentEvents: HostScoreEvent[]
}
