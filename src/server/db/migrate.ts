import { fileURLToPath, URL } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, hasDatabase } from './index.ts'

/**
 * Applies pending migrations at boot, before the server accepts traffic.
 *
 * The PRD calls for running these from a laptop against DATABASE_PUBLIC_URL,
 * but Railway provisions no public proxy for Postgres by default and the CLI
 * cannot create one — so that path needs a dashboard click that a deploy
 * cannot depend on. Migrating at startup removes the manual step entirely and
 * makes schema drift between code and database impossible.
 *
 * This uses drizzle-orm's runtime migrator, not drizzle-kit, so it does not
 * depend on a devDependency surviving into the deployed image.
 *
 * If a migration fails the process exits non-zero, the health check never
 * passes, and Railway keeps the previous deployment serving. That is the
 * correct failure mode: a broken migration should not replace a working game.
 */
export async function runMigrations() {
  if (!hasDatabase()) {
    console.warn('[migrate] DATABASE_URL not set — skipping migrations')
    return
  }

  const migrationsFolder = fileURLToPath(
    new URL('../../../drizzle', import.meta.url),
  )

  const startedAt = Date.now()
  await migrate(db(), { migrationsFolder })
  console.log(`[migrate] up to date in ${Date.now() - startedAt} ms`)
}
