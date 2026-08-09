import { z } from 'zod'

// Railway injects PORT and DATABASE_URL. Everything else comes from the service
// variables — never from the repo. DATABASE_URL is deliberately optional so the
// app still boots (and passes the health check) before Postgres is wired up.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional(),
  HOST_PIN: z.string().min(1).optional(),
  ADMIN_PIN: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment:', z.treeifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'
