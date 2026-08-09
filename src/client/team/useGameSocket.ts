import { useEffect, useRef, useState } from 'react'

export type SocketStatus = 'connecting' | 'open' | 'closed'

/**
 * The game socket, with reconnect backoff.
 *
 * A Railway redeploy drops every socket at once, and phones drop theirs every
 * time they lock — so reconnecting is the normal case, not the error case. The
 * backoff is capped low because the worst moment to be waiting is the one
 * where the steal window just opened.
 */
export function useGameSocket({
  role,
  gameId,
  teamId,
  onMessage,
}: {
  role: 'board' | 'host' | 'team'
  gameId?: string
  teamId?: string
  onMessage?: (msg: { type: string; [k: string]: unknown }) => void
}) {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const socketRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  useEffect(() => {
    if (!gameId) return

    let closed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (closed) return
      setStatus('connecting')

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${proto}//${window.location.host}/ws`)
      socketRef.current = socket

      socket.onopen = () => {
        attempt = 0
        setStatus('open')
        socket.send(JSON.stringify({ type: 'identify', role, gameId, teamId }))
      }

      socket.onmessage = (event) => {
        try {
          handlerRef.current?.(JSON.parse(String(event.data)))
        } catch {
          /* a malformed frame is not worth taking the phone down for */
        }
      }

      socket.onclose = () => {
        setStatus('closed')
        if (closed) return
        attempt += 1
        // 0.5s, 1s, 2s, 4s, then hold at 5s.
        const delay = Math.min(500 * 2 ** (attempt - 1), 5000)
        timer = setTimeout(connect, delay)
      }

      socket.onerror = () => socket.close()
    }

    connect()

    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      socketRef.current?.close()
    }
  }, [role, gameId, teamId])

  const send = (message: unknown) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
      return true
    }
    return false
  }

  return { status, send }
}
