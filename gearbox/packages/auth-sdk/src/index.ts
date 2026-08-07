/**
 * Room tokens: the contract between the control plane and the realtime plane.
 *
 * gearbox-core's POST /v1/sessions mints one; the room-server verifies it and takes
 * handle, role and room name from the CLAIMS — never from the client's query string.
 * This is the seam described in docs/gearbox/07-authz-security.md §7.3: the token is
 * scoped to exactly one room with exactly the granted role, so a leaked token cannot
 * be replayed into a different room or a higher role.
 */

import { SignJWT, jwtVerify } from 'jose';

export const ROOM_TOKEN_AUDIENCE = 'gearbox-room';

export interface RoomTokenClaims {
  /** User id. */
  sub: string;
  handle: string;
  role: 'owner' | 'admin' | 'collaborator' | 'viewer';
  room: string;
}

function keyOf(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error('Room token secret must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

export async function mintRoomToken(
  secret: string,
  claims: RoomTokenClaims,
  ttlSeconds = 3600,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ handle: claims.handle, role: claims.role, room: claims.room })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setAudience(ROOM_TOKEN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(keyOf(secret));
}

/** Throws on any invalid token: bad signature, wrong audience, expired. */
export async function verifyRoomToken(
  secret: string,
  token: string,
  now?: Date,
): Promise<RoomTokenClaims> {
  const { payload } = await jwtVerify(token, keyOf(secret), {
    audience: ROOM_TOKEN_AUDIENCE,
    algorithms: ['HS256'],
    ...(now ? { currentDate: now } : {}),
  });
  return {
    sub: payload.sub as string,
    handle: (payload.handle as string) ?? 'user',
    role: (payload.role as RoomTokenClaims['role']) ?? 'viewer',
    room: payload.room as string,
  };
}
