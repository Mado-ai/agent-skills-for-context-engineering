/**
 * Configuration. Validated once at startup — a misconfigured service should fail
 * loudly on boot, not on the first request that happens to touch the bad value.
 *
 * Secrets are never defaulted in production; see the `production` guard below.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** `LOCAL` runs the same image as an on-premises node (docs/gearbox/02-stack.md §2.1). */
  DEPLOYMENT_PROFILE: z.enum(['CLOUD', 'LOCAL']).default('CLOUD'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

  /** Signing key for access tokens. Rotated per the runbook; never committed. */
  JWT_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().default('https://api.gearbox.dev'),
  JWT_AUDIENCE: z.string().default('gearbox-client'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600), // 10 min
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30), // 30 days

  /** Shared secret for room tokens (docs/gearbox/07-authz-security.md §7.3). */
  ROOM_TOKEN_SECRET: z.string().min(32).optional(),
  /** Public base URL of the room-server, returned by POST /v1/sessions. */
  ROOM_SERVER_URL: z.string().default('ws://localhost:7777'),
  ROOM_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

const DEV_JWT_SECRET = 'development-only-secret-do-not-use-in-production-0000';
const DEV_ROOM_SECRET = 'development-only-room-secret-do-not-use-in-prod-00';

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction) {
    const missing: string[] = [];
    if (!env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!env.JWT_SECRET) missing.push('JWT_SECRET');
    if (!env.ROOM_TOKEN_SECRET) missing.push('ROOM_TOKEN_SECRET');
    if (missing.length > 0) {
      throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
    }
  }

  return {
    ...env,
    JWT_SECRET: env.JWT_SECRET ?? (isProduction ? undefined : DEV_JWT_SECRET),
    ROOM_TOKEN_SECRET: env.ROOM_TOKEN_SECRET ?? (isProduction ? undefined : DEV_ROOM_SECRET),
    isProduction,
    isTest: env.NODE_ENV === 'test',
  } as Config;
}
