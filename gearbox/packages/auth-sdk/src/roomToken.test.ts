import { describe, expect, it } from 'vitest';
import { mintRoomToken, verifyRoomToken } from './index.js';

const SECRET = 'a-room-token-secret-that-is-long-enough!';

describe('room tokens', () => {
  it('round-trips claims', async () => {
    const token = await mintRoomToken(SECRET, {
      sub: 'user-1',
      handle: 'ada',
      role: 'collaborator',
      room: 'demo',
    });
    const claims = await verifyRoomToken(SECRET, token);
    expect(claims).toEqual({ sub: 'user-1', handle: 'ada', role: 'collaborator', room: 'demo' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await mintRoomToken(SECRET, {
      sub: 'u',
      handle: 'h',
      role: 'viewer',
      room: 'demo',
    });
    await expect(
      verifyRoomToken('another-secret-that-is-also-long-enough!!', token),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const past = new Date('2026-01-01T00:00:00Z');
    const token = await mintRoomToken(
      SECRET,
      { sub: 'u', handle: 'h', role: 'viewer', room: 'demo' },
      60,
      past,
    );
    await expect(
      verifyRoomToken(SECRET, token, new Date('2026-01-01T01:00:00Z')),
    ).rejects.toThrow();
  });

  it('refuses a weak secret at mint time', async () => {
    await expect(
      mintRoomToken('short', { sub: 'u', handle: 'h', role: 'viewer', room: 'r' }),
    ).rejects.toThrow(/at least 32/);
  });
});
