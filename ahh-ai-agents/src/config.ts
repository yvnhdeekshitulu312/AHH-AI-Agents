import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_KEY: z.string().min(32, 'API_KEY must be at least 32 characters'),
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),

  HIS_BASE_URL: z.url().transform((v) => v.replace(/\/+$/, '')),
  HIS_USERNAME: z.string().min(1),
  HIS_PASSWORD: z.string().min(1),
  HIS_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),

  LLM_PROVIDER: z.enum(['google']).default('google'),
  MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  /** Model for the visit summary (one call per summary, so a stronger model is affordable). */
  SUMMARY_MODEL: z.string().min(1).default('gemini-3.5-flash'),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),

  AUDIT_HASH_SECRET: z.string().min(16, 'AUDIT_HASH_SECRET must be at least 16 characters'),
});

export type Config = z.infer<typeof configSchema>;

/** Validates environment variables. Throws with a readable list of problems. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
