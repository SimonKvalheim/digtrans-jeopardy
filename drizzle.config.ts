import { defineConfig } from 'drizzle-kit'

// Migrations are run from a laptop against DATABASE_PUBLIC_URL; the app itself
// connects over Railway's private network with DATABASE_URL. See PRD §5.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
