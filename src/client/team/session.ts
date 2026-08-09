const TOKEN_KEY = 'jeopardy.joinToken'

/**
 * The phone's identity, kept in localStorage (PRD §5.2).
 *
 * Over two hours every phone will lock and drop its socket. Without this the
 * game dies twenty minutes in — so the token outlives the connection, and
 * reconnecting silently restores the same team with no typing.
 */
export const teamSession = {
  token: () => localStorage.getItem(TOKEN_KEY) ?? '',
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export interface TeamMe {
  team: { id: string; name: string; score: number; seat: number }
  game: { id: string; code: string }
  canBuzz: boolean
  stealWinnerTeamId: string | null
  phase: string
  phaseEndsAt: string | null
}

export async function fetchMe(): Promise<TeamMe | null> {
  const token = teamSession.token()
  if (!token) return null

  const res = await fetch('/api/team/me', {
    headers: { 'x-join-token': token },
  })
  if (res.status === 404) {
    // The game was rebuilt; make the phone ask to join again rather than
    // silently pretending to be a team that no longer exists.
    teamSession.clear()
    return null
  }
  if (!res.ok) return null
  return (await res.json()) as TeamMe
}
