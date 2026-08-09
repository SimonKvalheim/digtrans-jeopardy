import { createServer } from 'node:http'
import { fileURLToPath, URL } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import { env, isProd } from './env.ts'

const app = express()
app.use(express.json({ limit: '25mb' })) // pack imports carry base64 images

// Railway's health check hits this. It must not touch Postgres — a database
// hiccup should not take the whole service out of rotation mid-party.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV })
})

const httpServer = createServer(app)

// The WebSocket lives on the same origin as the SPA: no CORS, no second domain.
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello' }))
})

if (isProd) {
  const clientDir = fileURLToPath(new URL('../../dist/client', import.meta.url))
  app.use(express.static(clientDir, { index: false }))
  // SPA fallback. Express 5 dropped '*' patterns, so this is a plain terminal
  // middleware rather than a route.
  app.use((_req, res) => {
    res.sendFile(`${clientDir}/index.html`)
  })
} else {
  // Dev runs Vite in middleware mode so development and production have the
  // same single-process, single-origin shape.
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

// Bind 0.0.0.0 and the injected PORT — hardcoding either fails Railway's health
// check. See PRD §5.
httpServer.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[server] listening on 0.0.0.0:${env.PORT} (${env.NODE_ENV})`)
})
