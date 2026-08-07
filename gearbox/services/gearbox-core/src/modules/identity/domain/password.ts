/**
 * Password hashing.
 *
 * Uses Node's built-in scrypt rather than argon2id, deliberately: argon2 bindings are
 * native and their build breaks in enough environments (Alpine, ARM CI, sandboxes) to
 * be a real operational cost. scrypt is memory-hard, in the standard library, and
 * fine at these parameters. See docs/adr/0003-password-hashing.md for the upgrade path
 * to argon2id — the encoded prefix below makes that migration a per-user rehash on
 * next login rather than a flag day.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify() picks the first overload, which drops the options argument. Re-type it
// so the cost parameters below are actually type-checked.
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** OWASP-aligned scrypt parameters: N=2^15, r=8, p=1 (~32 MB per hash). */
const PARAMS = { N: 32768, r: 8, p: 1, keyLen: 32, saltLen: 16 } as const;
const ALGO = 'scrypt';

/** Encoded as `scrypt$N$r$p$salt$hash`, all base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PARAMS.saltLen);
  const derived = await scrypt(password.normalize('NFKC'), salt, PARAMS.keyLen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  });

  return [
    ALGO,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== ALGO) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, 'base64url');
    expected = Buffer.from(parts[5] as string, 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A precomputed hash of a random string, used to equalize the cost of authenticating a
 * non-existent account against a real one. Without this, response timing tells an
 * attacker which emails are registered (docs/gearbox/07-authz-security.md §7.5 T1).
 */
let dummyHashPromise: Promise<string> | undefined;

export function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummyHashPromise;
}

/** True when a stored hash used weaker parameters than current policy. */
export function needsRehash(encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== ALGO) return true;
  return Number(parts[1]) < PARAMS.N;
}
