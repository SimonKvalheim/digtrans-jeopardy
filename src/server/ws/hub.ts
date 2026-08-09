import type { WebSocket } from 'ws'

/**
 * Tracks who is connected to which game, so a state change can be pushed
 * instead of waited for.
 *
 * Sockets are grouped by game rather than by role, because every push is
 * game-scoped and nothing here is big enough to need indexing twice.
 */

export interface Client {
  socket: WebSocket
  gameId?: string
  role: 'board' | 'host' | 'team' | 'unknown'
  teamId?: string
}

const clients = new Set<Client>()

export function register(socket: WebSocket): Client {
  const client: Client = { socket, role: 'unknown' }
  clients.add(client)
  socket.on('close', () => clients.delete(client))
  return client
}

export function send(client: Client, message: unknown) {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(message))
  }
}

/** Push to everyone watching one game. */
export function broadcast(gameId: string, message: unknown) {
  const payload = JSON.stringify(message)
  for (const client of clients) {
    if (client.gameId !== gameId) continue
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.send(payload)
    }
  }
}

/**
 * Tells every surface in a game that something changed and it should refetch.
 *
 * A nudge rather than the state itself: the board, the host console and a team
 * phone are each entitled to see different things — most importantly, only the
 * host may see answers — so each refetches from the endpoint that already
 * enforces that. It keeps one rule about who sees what instead of three.
 */
export function notifyChanged(gameId: string) {
  broadcast(gameId, { type: 'changed' })
}

export function clientCount() {
  return clients.size
}
