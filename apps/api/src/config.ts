import { z } from 'zod';

/**
 * Runtime configuration. Values come from the environment at deploy time; nothing here
 * has a secret default. Secrets are read from the platform secret store by reference
 * (AWS v1.7 s2 "Secrets"), never committed.
 */
export const ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
] as const;

const schema = z.object({
  SF_ENVIRONMENT: z.enum(ENVIRONMENTS).default('LOCAL'),
  SF_CELL_ID: z
    .string()
    .regex(/^cell-[a-z0-9-]{1,40}$/)
    .default('cell-local'),
  SF_SERVICE_NAME: z.string().min(1).default('serviceform-api'),
  SF_SERVICE_VERSION: z.string().min(1).default('0.0.0-dev'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(1_048_576),
  DATABASE_URL: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  /** CMP-036 edge rate limit: max requests per window per hashed client key. */
  SF_GATEWAY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000_000).default(300),
  SF_GATEWAY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(100).max(3_600_000).default(60_000),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Report only variable names, never values.
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid configuration for: ${names}`);
  }
  const config = parsed.data;
  if (!['LOCAL', 'CI'].includes(config.SF_ENVIRONMENT) && !config.DATABASE_URL) {
    throw new Error('Invalid configuration for: DATABASE_URL (required outside LOCAL/CI)');
  }
  return config;
}
