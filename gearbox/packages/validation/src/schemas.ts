/**
 * Shared zod schemas.
 *
 * These are the source of truth for request/response shapes; the OpenAPI document is
 * generated from them, and packages/api-client is generated from that
 * (docs/gearbox/06-api.md §6.1). Nothing validates by hand.
 */

import { z } from 'zod';

/** UUIDv7 — time-ordered and client-generatable (docs/gearbox/04-data-model.md §4.2). */
export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Handles are immutable identity. Display names are separate and moderatable —
 * conflating them is how impersonation reports become unactionable
 * (docs/gearbox/07-authz-security.md §7.5 T4).
 */
export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, 'Handle may contain only letters, numbers and underscores');

export const displayNameSchema = z.string().trim().min(1).max(48);

/**
 * Password policy: length over composition rules. Long passphrases beat forced
 * symbol classes, which mostly produce predictable substitutions.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256, 'Password must be at most 256 characters');

export const ageBandSchema = z.enum(['adult', 'teen', 'child', 'unknown']);

export const platformSchema = z.enum([
  'ios',
  'android',
  'quest',
  'visionos',
  'androidxr',
  'desktop',
  'web',
]);

/** Ed25519 public key, base64url, 32 raw bytes → 43 chars unpadded. */
export const publicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a base64url-encoded Ed25519 public key');

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  handle: handleSchema,
  displayName: displayNameSchema.optional(),
  ageBand: ageBandSchema.default('adult'),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const passwordGrantSchema = z.object({
  grantType: z.literal('password'),
  email: emailSchema,
  password: z.string().min(1).max(256),
  deviceId: uuidSchema.optional(),
});

export const refreshGrantSchema = z.object({
  grantType: z.literal('refresh'),
  refreshToken: z.string().min(20).max(512),
});

export const deviceAssertionGrantSchema = z.object({
  grantType: z.literal('device_assertion'),
  deviceId: uuidSchema,
  /** base64url signature over the server-issued challenge nonce. */
  signature: z.string().min(16).max(512),
  nonce: z.string().min(16).max(256),
});

export const tokenRequestSchema = z.discriminatedUnion('grantType', [
  passwordGrantSchema,
  refreshGrantSchema,
  deviceAssertionGrantSchema,
]);
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
  userId: uuidSchema,
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const registerDeviceRequestSchema = z.object({
  publicKey: publicKeySchema,
  platform: platformSchema,
  deviceName: z.string().trim().max(64).optional(),
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export const profileSchema = z.object({
  userId: uuidSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
  pronouns: z.string().trim().max(32).nullable(),
  bio: z.string().trim().max(500).nullable(),
  locale: z.string().max(16),
});
export type Profile = z.infer<typeof profileSchema>;

export const updateProfileRequestSchema = z
  .object({
    displayName: displayNameSchema,
    pronouns: z.string().trim().max(32).nullable(),
    bio: z.string().trim().max(500).nullable(),
    locale: z.string().max(16),
  })
  .partial();
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const paginationSchema = z.object({
  cursor: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** WGS84 position report from a phone client (docs/gearbox/11-geospatial-mvp.md §11.5). */
export const locationFixSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Horizontal accuracy in metres, as reported by the OS. */
  accuracyM: z.number().min(0).max(10000),
  altitudeM: z.number().min(-500).max(9000).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  speedMps: z.number().min(0).max(400).optional(),
  capturedAt: z.coerce.date(),
  /** Step count delta since the previous fix — the strongest anti-spoof signal (§11.6). */
  stepDelta: z.number().int().min(0).max(100000).optional(),
  /** OS mock-location flag, when the platform exposes it. */
  isMock: z.boolean().optional(),
});
export type LocationFix = z.infer<typeof locationFixSchema>;
