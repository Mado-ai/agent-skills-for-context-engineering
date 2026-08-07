/**
 * Access and refresh token primitives (docs/gearbox/07-authz-security.md §7.3).
 *
 * Access tokens are short-lived JWTs carrying only the claims needed for the current
 * request — never a full permission dump, because permissions change faster than a
 * token's lifetime and the server re-resolves them anyway.
 *
 * Refresh tokens are opaque random strings. Only their hash is stored, so a database
 * read does not yield usable credentials.
 */

import { createHash, randomBytes, verify as cryptoVerify, createPublicKey } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export interface AccessTokenClaims {
  sub: string; // userId
  did?: string; // deviceId — binds the token to a device
  ageBand: string;
  scope: string[];
}

export interface TokenIssuerOptions {
  secret: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
}

export class AccessTokenIssuer {
  private readonly key: Uint8Array;

  constructor(private readonly opts: TokenIssuerOptions) {
    if (opts.secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }
    this.key = new TextEncoder().encode(opts.secret);
  }

  async issue(claims: AccessTokenClaims, now: Date = new Date()): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ ageBand: claims.ageBand, scope: claims.scope, did: claims.did })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.opts.issuer)
      .setAudience(this.opts.audience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.opts.accessTtlSeconds)
      .sign(this.key);
  }

  /**
   * `now` is injectable so verification uses the same clock as issuance. Without it the
   * issuer would be only half clock-injected — signing against one clock and validating
   * against another — which breaks deterministic tests and any deployment that needs a
   * skew allowance.
   */
  async verify(token: string, now?: Date): Promise<AccessTokenClaims & { exp: number }> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: this.opts.issuer,
      audience: this.opts.audience,
      algorithms: ['HS256'],
      ...(now ? { currentDate: now } : {}),
    });
    return {
      sub: payload.sub as string,
      did: payload.did as string | undefined,
      ageBand: (payload.ageBand as string) ?? 'unknown',
      scope: (payload.scope as string[]) ?? [],
      exp: payload.exp as number,
    };
  }
}

/** 256 bits of entropy, base64url. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 is correct here (unlike for passwords): the input already has 256 bits of
 * entropy, so there is nothing to brute-force and a slow KDF would only add latency.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function generateNonce(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Verifies an Ed25519 assertion over a server-issued nonce. This is what lets a device
 * authenticate with no password and — importantly — with no network, which is the
 * foundation of offline/local mode (docs/gearbox/07-authz-security.md §7.4).
 */
export function verifyDeviceAssertion(
  publicKeyBase64Url: string,
  nonce: string,
  signatureBase64Url: string,
): boolean {
  try {
    const raw = Buffer.from(publicKeyBase64Url, 'base64url');
    if (raw.length !== 32) return false;

    // Wrap the raw 32-byte key in the SPKI prefix Node's KeyObject expects.
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });

    return cryptoVerify(
      null,
      Buffer.from(nonce, 'utf8'),
      key,
      Buffer.from(signatureBase64Url, 'base64url'),
    );
  } catch {
    return false;
  }
}
