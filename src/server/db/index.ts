import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env.ts'
import * as schema from './schema.ts'

/**
 * The app connects over Railway's private network with DATABASE_URL.
 * DATABASE_PUBLIC_URL is for running migrations from a laptop and nothing else.
 *
 * The connection is lazy so the service still boots — and still passes its
 * health check — when Postgres is unreachable. A database that is down should
 * not take the whole surface out of rotation mid-party.
 */

let pool: pg.Pool | undefined
let instance: ReturnType<typeof drizzle<typeof schema>> | undefined

export function hasDatabase(): boolean {
  return Boolean(env.DATABASE_URL)
}

export function db() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — cannot reach Postgres')
  }
  if (!instance) {
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      // Fail fast rather than hanging a host-console tap on a dead socket.
      connectionTimeoutMillis: 5000,
    })
    instance = drizzle(pool, { schema })
  }
  return instance
}

export async function closeDatabase() {
  await pool?.end()
  pool = undefined
  instance = undefined
}

export { schema }
