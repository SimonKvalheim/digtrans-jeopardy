import { createServer } from 'node:http'
import { fileURLToPath, URL } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import { env, isProd } from './env.ts'
import { runMigrations } from './db/migrate.ts'
import { db, hasDatabase, schema } from './db/index.ts'
import { adminRouter } from './routes/admin.ts'
import { hostRouter } from './routes/host.ts'
import { boardRouter } from './routes/board.ts'

// Before anything is served. A failed migration exits non-zero, the health
// check never passes, and Railway keeps the previous deployment running.
await runMigrations()

const app = express()
app.use(express.json({ limit: '25mb' })) // pack imports carry base64 images

// Railway's health check hits this. It must not touch Postgres — a database
// hiccup should not take the whole service out of rotation mid-party.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV })
})

// Deliberately separate from the health check: this one does touch Postgres,
// so there is a way to tell "the app is down" from "the database is down"
// without a laptop. Useful at 21:30 with only a phone.
app.get('/readyz', async (_req, res) => {
  if (!hasDatabase()) {
    res.status(503).json({ ok: false, db: 'DATABASE_URL not set' })
    return
  }
  try {
    // A count, not the slugs: this route is public, and pack names are a hint
    // about the content even though they are not the answers.
    const rows = await db().select({ id: schema.packs.id }).from(schema.packs)
    res.json({ ok: true, db: 'up', packs: rows.length })
  } catch (error) {
    res.status(503).json({
      ok: false,
      db: error instanceof Error ? error.message : String(error),
    })
  }
})

app.use('/api/admin', adminRouter)
app.use('/api/host', hostRouter)
app.use('/api/board', boardRouter)

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
