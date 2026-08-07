/**
 * Service entrypoint. Wires concrete adapters to the ports and starts the HTTP server.
 *
 * The only place in the service that knows about both Postgres and the application
 * layer — everything else depends on ports (docs/gearbox/02-stack.md §2.5).
 */

import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { buildServer } from './http/server.js';
import { IdentityService } from './modules/identity/application/identityService.js';
import { AccessTokenIssuer } from './modules/identity/domain/tokens.js';
import { systemClock } from './modules/identity/ports/index.js';
import {
  DrizzleAuditSink,
  DrizzleChallengeStore,
  DrizzleDeviceRepository,
  DrizzleRefreshTokenStore,
  DrizzleUserRepository,
} from './modules/identity/infrastructure/drizzleRepositories.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env and run `pnpm dev:infra`.',
    );
  }

  const { db, close } = createDatabase(config.DATABASE_URL);

  const issuer = new AccessTokenIssuer({
    secret: config.JWT_SECRET as string,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  });

  const identity = new IdentityService({
    users: new DrizzleUserRepository(db),
    devices: new DrizzleDeviceRepository(db),
    refreshTokens: new DrizzleRefreshTokenStore(db),
    challenges: new DrizzleChallengeStore(db),
    audit: new DrizzleAuditSink(db),
    clock: systemClock,
    issuer,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  });

  const app = buildServer({ config, identity, issuer, clock: systemClock });

  // Drain in-flight requests before exiting so a deploy does not drop responses.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error('[startup] failed:', err);
  process.exit(1);
});
