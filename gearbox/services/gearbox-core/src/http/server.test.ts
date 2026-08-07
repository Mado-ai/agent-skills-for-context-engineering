/**
 * API-level tests: real Fastify app, real routing, real serialization, in-memory
 * adapters underneath. These cover the contract a client actually sees — status codes,
 * Problem Details shape, and auth enforcement — which unit tests of the service do not.
 */

import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { loadConfig } from '../config.js';
import { IdentityService } from '../modules/identity/application/identityService.js';
import { AccessTokenIssuer } from '../modules/identity/domain/tokens.js';
import {
  MemoryAuditSink,
  MemoryChallengeStore,
  MemoryDeviceRepository,
  MemoryRefreshTokenStore,
  MemoryUserRepository,
} from '../modules/identity/infrastructure/memoryRepositories.js';
import type { Clock } from '../modules/identity/ports/index.js';

const clock: Clock = { now: () => new Date() };

function app() {
  const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const issuer = new AccessTokenIssuer({
    secret: config.JWT_SECRET as string,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  });
  const identity = new IdentityService({
    users: new MemoryUserRepository(),
    devices: new MemoryDeviceRepository(),
    refreshTokens: new MemoryRefreshTokenStore(),
    challenges: new MemoryChallengeStore(),
    audit: new MemoryAuditSink(),
    clock,
    issuer,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  });
  return buildServer({ config, identity, issuer, clock });
}

const VALID = {
  email: 'grace@example.com',
  password: 'a really quite long password',
  handle: 'grace',
};

async function registered(server: ReturnType<typeof app>) {
  const res = await server.inject({ method: 'POST', url: '/v1/auth/register', payload: VALID });
  return res.json() as { accessToken: string; refreshToken: string; userId: string };
}

describe('health', () => {
  it('reports the protocol version so a client can fail fast on mismatch', async () => {
    const res = await app().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', protocolVersion: 1 });
  });
});

describe('POST /v1/auth/register', () => {
  it('creates an account and returns 201 with tokens', async () => {
    const res = await app().inject({ method: 'POST', url: '/v1/auth/register', payload: VALID });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tokenType).toBe('Bearer');
    expect(body.accessToken).toBeTruthy();
  });

  it('rejects a short password with Problem Details listing the field', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...VALID, password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json();
    expect(body.type).toContain('validation-failed');
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'password' })]),
    );
  });

  it('rejects an invalid handle', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...VALID, handle: 'has spaces!' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 on a duplicate email', async () => {
    const server = app();
    await server.inject({ method: 'POST', url: '/v1/auth/register', payload: VALID });
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...VALID, handle: 'someoneelse' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().field).toBe('email');
  });
});

describe('POST /v1/auth/token', () => {
  it('issues tokens for the password grant', async () => {
    const server = app();
    await registered(server);
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { grantType: 'password', email: VALID.email, password: VALID.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
  });

  it('returns 401 with an identical body for wrong password and unknown account', async () => {
    const server = app();
    await registered(server);

    const wrong = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { grantType: 'password', email: VALID.email, password: 'nope-not-this-one' },
    });
    const unknown = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { grantType: 'password', email: 'ghost@example.com', password: 'nope-not-this-one' },
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual({ ...wrong.json(), instance: unknown.json().instance });
  });

  it('rotates on the refresh grant and 401s on replay', async () => {
    const server = app();
    const first = await registered(server);

    const rotated = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { grantType: 'refresh', refreshToken: first.refreshToken },
    });
    expect(rotated.statusCode).toBe(200);

    const replay = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { grantType: 'refresh', refreshToken: first.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().type).toContain('token-reused');
  });

  it('rejects an unknown grant type at the schema boundary', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { grantType: 'magic', email: VALID.email },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('authenticated routes', () => {
  it('401s without a token', async () => {
    const res = await app().inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('401s with a malformed token', async () => {
    const res = await app().inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the caller with a valid token', async () => {
    const server = app();
    const tokens = await registered(server);
    const res = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(tokens.userId);
  });
});

describe('device flow over HTTP', () => {
  it('registers a device, challenges it, and authenticates by assertion', async () => {
    const server = app();
    const tokens = await registered(server);

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);

    const created = await server.inject({
      method: 'POST',
      url: '/v1/auth/devices',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { publicKey: Buffer.from(raw).toString('base64url'), platform: 'ios' },
    });
    expect(created.statusCode).toBe(201);
    const deviceId = created.json().id as string;

    const challenge = await server.inject({
      method: 'POST',
      url: `/v1/auth/devices/${deviceId}/challenge`,
    });
    expect(challenge.statusCode).toBe(200);
    const nonce = challenge.json().nonce as string;

    const signature = cryptoSign(null, Buffer.from(nonce, 'utf8'), privateKey).toString(
      'base64url',
    );
    const asserted = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      payload: { grantType: 'device_assertion', deviceId, nonce, signature },
    });
    expect(asserted.statusCode).toBe(200);
    expect(asserted.json().userId).toBe(tokens.userId);
  });

  it('requires authentication to register a device', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/v1/auth/devices',
      payload: { publicKey: 'A'.repeat(43), platform: 'ios' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('not found', () => {
  it('returns Problem Details for an unknown route', async () => {
    const res = await app().inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().type).toContain('not-found');
  });
});
