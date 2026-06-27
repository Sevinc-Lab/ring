import { z } from 'zod'

/**
 * Environment configuration for the Ring worker.
 *
 * Note on booleans: `z.coerce.boolean()` treats the string "false" as truthy,
 * so RECORD_SNAPSHOT is parsed explicitly as `value === 'true'`.
 */
const boolFromEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v.toLowerCase() === 'true'))

const EnvSchema = z.object({
  // Auth
  RING_REFRESH_TOKEN: z.string().optional().default(''),
  RING_CONTROL_CENTER_NAME: z.string().min(1).default('local-nvr'),

  // Paths (container-internal; mounted onto SATA)
  DATA_MEDIA_DIR: z.string().min(1).default('/data/media'),
  DATA_DB_PATH: z.string().min(1).default('/data/db/ring.db'),
  TOKEN_FILE: z.string().min(1).default('/data/secrets/refresh-token'),
  HEARTBEAT_FILE: z.string().min(1).default('/data/db/.heartbeat'),

  // Recording (M2)
  CLIP_SECONDS: z.coerce.number().int().positive().max(600).default(30),
  RECORD_SNAPSHOT: boolFromEnv(false),

  // Operation
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEVICE_FILTER: z.string().optional().default(''),
})

export type Config = z.infer<typeof EnvSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${issues}`)
  }
  return parsed.data
}

/**
 * Parse DEVICE_FILTER ("" = no filter) into a list of id/name needles.
 *
 * Defensive: strip an inline `# comment` first. docker compose's `env_file`
 * does not reliably strip trailing inline comments, so a value like
 * `DEVICE_FILTER=   # ...` would otherwise arrive as the comment text and match
 * no cameras. Treating everything from the first `#` as a comment keeps a
 * mis-formatted .env from turning into a fatal "matched no cameras" loop.
 */
export function parseDeviceFilter(raw: string): string[] {
  const withoutComment = raw.split('#')[0]
  return withoutComment
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
