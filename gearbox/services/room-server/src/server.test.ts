/**
 * End-to-end over real sockets: headless bot clients speaking the real wire protocol
 * against the real server. This is the seed of the bot harness that
 * docs/gearbox/01-assumptions-risks.md R3 calls non-negotiable — every future desync
 * report gets reproduced with a bot before it gets debugged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { decode, encode, type DecodedMessage, type Quat, type Vec3 } from '@gearbox/protocol';
import { startRoomServer, type RunningRoomServer } from './server.js';

const identity: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Headless protocol client. Speaks the wire, not the engine. */
class Bot {
  private ws!: WebSocket;
  readonly binary: DecodedMessage[] = [];
  readonly json: Array<Record<string, unknown>> = [];
  private tickSeq = 0;

  static async join(port: number, room: string, handle: string, role: string): Promise<Bot> {
    const bot = new Bot();
    bot.ws = new WebSocket(`ws://127.0.0.1:${port}/rooms/${room}?handle=${handle}&role=${role}`);
    bot.ws.binaryType = 'arraybuffer';
    bot.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        bot.binary.push(decode(new Uint8Array(data as ArrayBuffer)));
      } else {
        bot.json.push(JSON.parse(String(data)) as Record<string, unknown>);
      }
    });
    await new Promise<void>((resolve, reject) => {
      bot.ws.once('open', resolve);
      bot.ws.once('error', reject);
    });
    await bot.waitForJson((m) => m.type === 'welcome');
    return bot;
  }

  get welcome(): Record<string, unknown> {
    const w = this.json.find((m) => m.type === 'welcome');
    if (!w) throw new Error('no welcome received');
    return w;
  }

  get selfIndex(): number {
    return this.welcome.selfIndex as number;
  }

  sendPose(x: number, y = 1.6, z = 0): void {
    const p: Vec3 = { x, y, z };
    this.ws.send(
      encode('PoseUpdate', {
        participantId: this.selfIndex,
        tickSeq: this.tickSeq++,
        headPos: p,
        headRot: identity,
        leftHandPos: p,
        leftHandRot: identity,
        rightHandPos: p,
        rightHandRot: identity,
        trackingFlags: 1,
        voiceAmplitude: 0,
      }),
    );
  }

  sendJson(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  requestOwnership(objectId: number): void {
    this.ws.send(encode('OwnershipRequest', { objectId, intent: 0 }));
  }

  sendTransform(objectId: number, epoch: number, x: number): void {
    this.ws.send(
      encode('TransformUpdate', {
        objectId,
        epoch,
        position: { x, y: 1.4, z: -1 },
        rotation: identity,
        flags: 0,
      }),
    );
  }

  release(objectId: number, epoch: number, x: number): void {
    this.ws.send(
      encode('OwnershipRelease', {
        objectId,
        epoch,
        finalPosition: { x, y: 1.4, z: -1 },
        finalRotation: identity,
      }),
    );
  }

  binaryByName(name: string): DecodedMessage[] {
    return this.binary.filter((m) => m.name === name);
  }

  async waitForBinary(
    pred: (m: DecodedMessage) => boolean,
    timeoutMs = 3000,
  ): Promise<DecodedMessage> {
    return waitFor(() => this.binary.find(pred), timeoutMs, 'binary message');
  }

  async waitForJson(
    pred: (m: Record<string, unknown>) => boolean,
    timeoutMs = 3000,
  ): Promise<Record<string, unknown>> {
    return waitFor(() => this.json.find(pred), timeoutMs, 'json message');
  }

  close(): void {
    this.ws.close();
  }
}

async function waitFor<T>(get: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = get();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

let server: RunningRoomServer;

beforeAll(async () => {
  server = await startRoomServer({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await server.close();
});

describe('room-server over real sockets', () => {
  it('relays poses between participants with server-stamped identity', async () => {
    const a = await Bot.join(server.port, 'poses', 'ada', 'collaborator');
    const b = await Bot.join(server.port, 'poses', 'sam', 'collaborator');

    a.sendPose(1.5);
    const relayed = await b.waitForBinary((m) => m.name === 'PoseUpdate');
    expect(relayed.body.participantId).toBe(a.selfIndex);
    expect((relayed.body.headPos as Vec3).x).toBeCloseTo(1.5, 2);

    a.close();
    b.close();
    await settle();
  });

  it('ownership contention: exactly one holder, loser denied', async () => {
    const a = await Bot.join(server.port, 'contention', 'ada', 'collaborator');
    const b = await Bot.join(server.port, 'contention', 'sam', 'collaborator');

    a.requestOwnership(0);
    b.requestOwnership(0);

    const grant = await a.waitForBinary((m) => m.name === 'OwnershipGrant');
    const denial = await b.waitForJson((m) => m.type === 'denied');

    expect(grant.body.holderId).toBe(a.selfIndex);
    expect(denial.reason).toBe('held');
    expect(server.room('contention')!.objectState(0)!.holder).toBe(a.selfIndex);

    a.close();
    b.close();
    await settle();
  });

  it('grab → move → release → late joiner sees the moved state', async () => {
    const a = await Bot.join(server.port, 'latejoin', 'ada', 'collaborator');

    a.requestOwnership(2);
    const grant = await a.waitForBinary((m) => m.name === 'OwnershipGrant');
    const epoch = grant.body.epoch as number;

    a.sendTransform(2, epoch, 2.5);
    a.release(2, epoch, 2.5);
    await settle();

    const late = await Bot.join(server.port, 'latejoin', 'late', 'viewer');
    const objects = late.welcome.objects as Array<{
      index: number;
      position: number[];
      holder: number | null;
    }>;
    const obj = objects.find((o) => o.index === 2)!;
    expect(obj.position[0]).toBeCloseTo(2.5, 1);
    expect(obj.holder).toBeNull();

    a.close();
    late.close();
    await settle();
  });

  it('a viewer cannot take ownership over the realtime channel', async () => {
    const v = await Bot.join(server.port, 'authz', 'viewer', 'viewer');
    v.requestOwnership(0);
    const denial = await v.waitForJson((m) => m.type === 'denied');
    expect(denial.reason).toBe('role');
    expect(server.room('authz')!.objectState(0)!.holder).toBeNull();
    v.close();
    await settle();
  });

  it('an unknown role degrades to viewer, never escalates', async () => {
    const sneaky = await Bot.join(server.port, 'roles', 'sneaky', 'superadmin');
    sneaky.requestOwnership(0);
    const denial = await sneaky.waitForJson((m) => m.type === 'denied');
    expect(denial.reason).toBe('role');
    sneaky.close();
    await settle();
  });

  it('disconnect releases held objects for the survivors', async () => {
    const a = await Bot.join(server.port, 'dc', 'ada', 'collaborator');
    const b = await Bot.join(server.port, 'dc', 'sam', 'collaborator');

    a.requestOwnership(1);
    await a.waitForBinary((m) => m.name === 'OwnershipGrant');

    a.close();

    const release = await b.waitForBinary((m) => m.name === 'OwnershipRelease');
    expect(release.body.objectId).toBe(1);
    await b.waitForJson((m) => m.type === 'participant_leave');

    b.close();
    await settle();
  });
});

describe('room tokens', () => {
  const SECRET = 'a-room-token-secret-that-is-long-enough!';
  let secured: RunningRoomServer;

  beforeAll(async () => {
    secured = await startRoomServer({ port: 0, host: '127.0.0.1', tokenSecret: SECRET });
  });

  afterAll(async () => {
    await secured.close();
  });

  async function joinWithToken(token: string | null, room = 'sec'): Promise<WebSocket> {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`ws://127.0.0.1:${secured.port}/rooms/${room}${q}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return ws;
  }

  function closeCode(ws: WebSocket): Promise<number> {
    return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  }

  it('admits a valid token and takes identity from its claims, not the query', async () => {
    const { mintRoomToken } = await import('@gearbox/auth-sdk');
    const token = await mintRoomToken(SECRET, {
      sub: 'user-1',
      handle: 'ada',
      role: 'viewer',
      room: 'sec',
    });
    // Note the query tries to claim collaborator; the token's viewer must win.
    const ws = new WebSocket(
      `ws://127.0.0.1:${secured.port}/rooms/sec?token=${encodeURIComponent(token)}&role=collaborator&handle=fake`,
    );
    const welcome = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          const msg = JSON.parse(String(data));
          if (msg.type === 'welcome') resolve(msg);
        }
      });
      ws.once('error', reject);
    });
    const participants = welcome.participants as Array<{ handle: string; role: string }>;
    const self = participants.find((p) => p.handle === 'ada');
    expect(self).toBeDefined();
    expect(self!.role).toBe('viewer');
    expect(participants.some((p) => p.handle === 'fake')).toBe(false);
    ws.close();
    await settle();
  });

  it('rejects a missing token', async () => {
    const ws = await joinWithToken(null);
    expect(await closeCode(ws)).toBe(4401);
  });

  it('rejects a tampered token', async () => {
    const { mintRoomToken } = await import('@gearbox/auth-sdk');
    const token = await mintRoomToken(SECRET, {
      sub: 'u',
      handle: 'h',
      role: 'owner',
      room: 'sec',
    });
    const ws = await joinWithToken(token.slice(0, -4) + 'AAAA');
    expect(await closeCode(ws)).toBe(4401);
  });

  it('rejects a token scoped to a different room', async () => {
    const { mintRoomToken } = await import('@gearbox/auth-sdk');
    const token = await mintRoomToken(SECRET, {
      sub: 'u',
      handle: 'h',
      role: 'owner',
      room: 'other-room',
    });
    const ws = await joinWithToken(token, 'sec');
    expect(await closeCode(ws)).toBe(4403);
  });
});

describe('persistence', () => {
  it('a moved object survives everyone leaving and the room being evicted', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join: joinPath } = await import('node:path');
    const dir = mkdtempSync(joinPath(tmpdir(), 'gearbox-rooms-'));

    const persisted = await startRoomServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: dir,
      saveDebounceMs: 20,
    });

    // Session one: move an object and leave.
    const a = await Bot.join(persisted.port, 'homeroom', 'ada', 'collaborator');
    a.requestOwnership(1);
    const grant = await a.waitForBinary((m) => m.name === 'OwnershipGrant');
    const epoch = grant.body.epoch as number;
    a.sendTransform(1, epoch, 3.1);
    a.release(1, epoch, 3.1);
    await settle();
    a.close();
    await settle(200); // eviction + flush

    expect(persisted.room('homeroom')).toBeUndefined(); // room really was evicted

    // Session two: a brand-new room instance loads the persisted state.
    const b = await Bot.join(persisted.port, 'homeroom', 'sam', 'collaborator');
    const objects = b.welcome.objects as Array<{ index: number; position: number[] }>;
    expect(objects.find((o) => o.index === 1)!.position[0]).toBeCloseTo(3.1, 1);
    b.close();
    await settle();
    await persisted.close();
  });
});

describe('rtc relay over sockets', () => {
  it('routes signaling to the addressed peer only', async () => {
    const a = await Bot.join(server.port, 'rtc', 'ada', 'collaborator');
    const b = await Bot.join(server.port, 'rtc', 'sam', 'collaborator');
    const c = await Bot.join(server.port, 'rtc', 'mira', 'collaborator');

    a.sendJson({ type: 'rtc', to: b.selfIndex, payload: { kind: 'offer', sdp: 'v=0' } });

    const relayed = await b.waitForJson((m) => m.type === 'rtc');
    expect(relayed.from).toBe(a.selfIndex);
    expect((relayed.payload as { kind: string }).kind).toBe('offer');
    expect(c.json.filter((m) => m.type === 'rtc')).toHaveLength(0);

    a.close();
    b.close();
    c.close();
    await settle();
  });
});
