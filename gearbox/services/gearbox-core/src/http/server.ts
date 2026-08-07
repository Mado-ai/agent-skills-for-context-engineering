/**
 * Fastify application assembly.
 *
 * The server is built from injected dependencies rather than reaching for module-level
 * singletons, so tests construct a real HTTP app over in-memory adapters and exercise
 * the same routes, serialization and error handling that production uses.
 */

import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { AppError, ERROR_TYPES, parseOrThrow } from '@gearbox/validation';
import {
  registerDeviceRequestSchema,
  registerRequestSchema,
  tokenRequestSchema,
} from '@gearbox/validation';
import { PROTOCOL_VERSION } from '@gearbox/protocol';
import type { IdentityService } from '../modules/identity/application/identityService.js';
import type { AccessTokenIssuer } from '../modules/identity/domain/tokens.js';
import type { Clock } from '../modules/identity/ports/index.js';
import type { Config } from '../config.js';

export interface ServerDeps {
  config: Config;
  identity: IdentityService;
  issuer: AccessTokenIssuer;
  clock: Clock;
}

declare module 'fastify' {
  interface FastifyRequest {
    caller?: { userId: string; deviceId?: string; ageBand: string };
  }
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.config.isTest ? false : { level: deps.config.LOG_LEVEL },
    // Trust the proxy for client IP, which rate limiting depends on.
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  /** Every error leaves as RFC 9457 Problem Details (docs/gearbox/06-api.md §6.1). */
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      if (!error.clientSafe) {
        request.log.error({ err: error, reqId: request.id }, 'internal error');
      }
      return reply
        .status(error.status)
        .type('application/problem+json')
        .send(error.toProblem(request.url));
    }

    // Fastify's own validation and parse errors.
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .type('application/problem+json')
        .send(new AppError(ERROR_TYPES.VALIDATION_FAILED, error.message).toProblem(request.url));
    }

    request.log.error({ err: error, reqId: request.id }, 'unhandled error');
    return reply
      .status(500)
      .type('application/problem+json')
      .send(AppError.internal('Unexpected error').toProblem(request.url));
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .type('application/problem+json')
      .send(AppError.notFound('Route').toProblem(request.url)),
  );

  async function requireAuth(request: FastifyRequest): Promise<{
    userId: string;
    deviceId?: string;
    ageBand: string;
  }> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthenticated('Missing bearer token');
    }
    try {
      const claims = await deps.issuer.verify(header.slice(7), deps.clock.now());
      const caller = { userId: claims.sub, deviceId: claims.did, ageBand: claims.ageBand };
      request.caller = caller;
      return caller;
    } catch {
      throw AppError.unauthenticated('Access token is invalid or expired');
    }
  }

  // ── health ────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', protocolVersion: PROTOCOL_VERSION }));
  app.get('/health/ready', async () => ({ status: 'ready' }));

  // ── auth ──────────────────────────────────────────────────────────────────
  app.post('/v1/auth/register', async (request, reply) => {
    const body = parseOrThrow(registerRequestSchema, request.body);
    const result = await deps.identity.register(body);
    return reply.status(201).send(result.tokens);
  });

  app.post('/v1/auth/token', async (request) => {
    const body = parseOrThrow(tokenRequestSchema, request.body);
    switch (body.grantType) {
      case 'password':
        return deps.identity.authenticateWithPassword(body.email, body.password, body.deviceId);
      case 'refresh':
        return deps.identity.refresh(body.refreshToken);
      case 'device_assertion':
        return deps.identity.authenticateWithDeviceAssertion(
          body.deviceId,
          body.nonce,
          body.signature,
        );
    }
  });

  app.post('/v1/auth/devices', async (request, reply) => {
    const caller = await requireAuth(request);
    const body = parseOrThrow(registerDeviceRequestSchema, request.body);
    const device = await deps.identity.registerDevice(caller.userId, body);
    return reply.status(201).send({
      id: device.id,
      platform: device.platform,
      deviceName: device.deviceName,
    });
  });

  app.delete('/v1/auth/devices/:id', async (request, reply) => {
    const caller = await requireAuth(request);
    const { id } = request.params as { id: string };
    await deps.identity.revokeDevice(caller.userId, id);
    return reply.status(204).send();
  });

  app.post('/v1/auth/devices/:id/challenge', async (request) => {
    const { id } = request.params as { id: string };
    // Unauthenticated by design: the challenge is useless without the private key,
    // and requiring a token here would defeat the purpose of the grant.
    return deps.identity.createDeviceChallenge(id);
  });

  // ── me ────────────────────────────────────────────────────────────────────
  app.get('/v1/me', async (request) => {
    const caller = await requireAuth(request);
    return { userId: caller.userId, ageBand: caller.ageBand, deviceId: caller.deviceId ?? null };
  });

  return app;
}
