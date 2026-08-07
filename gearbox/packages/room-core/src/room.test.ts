/**
 * The authoritative-room rules, tested synchronously with recording connections and
 * an injected clock. These are the three critical scenarios from
 * docs/gearbox/10-quality-devops.md §10.1 plus the supporting invariants.
 */

import { describe, expect, it } from 'vitest';
import { decode, encode, type Quat, type Vec3 } from '@gearbox/protocol';
import { AuthoritativeRoom } from './room.js';
import type { ObjectSpec, RoomConnection, ServerMessage } from './types.js';

const identity: Quat = { x: 0, y: 0, z: 0, w: 1 };
const OBJECTS: ObjectSpec[] = [
  { id: 'item-a', position: { x: 0, y: 1.2, z: -2 }, rotation: identity },
  { id: 'item-b', position: { x: 1, y: 1.2, z: -2 }, rotation: identity },
];

class RecordingConn implements RoomConnection {
  readonly binary: ReturnType<typeof decode>[] = [];
  readonly json: ServerMessage[] = [];
  sendBinary(bytes: Uint8Array): void {
    this.binary.push(decode(bytes));
  }
  sendJson(message: ServerMessage): void {
    this.json.push(message);
  }
  byName(name: string): ReturnType<typeof decode>[] {
    return this.binary.filter((m) => m.name === name);
  }
  jsonByType<T extends ServerMessage['type']>(type: T): ServerMessage[] {
    return this.json.filter((m) => m.type === type);
  }
}

class TestClock {
  t = 1_000_000;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

function setup(): {
  room: AuthoritativeRoom;
  clock: TestClock;
  joinAs: (handle: string, role?: 'owner' | 'collaborator' | 'viewer') => [number, RecordingConn];
} {
  const clock = new TestClock();
  const room = new AuthoritativeRoom(OBJECTS, clock.now);
  return {
    room,
    clock,
    joinAs: (handle, role = 'collaborator') => {
      const conn = new RecordingConn();
      const index = room.join(conn, { handle, role });
      return [index, conn];
    },
  };
}

function pose(participantId: number, x: number, y = 1.6, z = 0): Uint8Array {
  const p: Vec3 = { x, y, z };
  return encode('PoseUpdate', {
    participantId,
    tickSeq: 1,
    headPos: p,
    headRot: identity,
    leftHandPos: p,
    leftHandRot: identity,
    rightHandPos: p,
    rightHandRot: identity,
    trackingFlags: 1,
    voiceAmplitude: 0,
  });
}

describe('join and snapshots', () => {
  it('welcomes a joiner with the current participant list and object states', () => {
    const { joinAs } = setup();
    const [, connA] = joinAs('ada');
    const [, connB] = joinAs('sam');

    const welcomeB = connB.jsonByType('welcome')[0] as {
      participants: unknown[];
      objects: { id: string }[];
    };
    expect(welcomeB.participants).toHaveLength(2);
    expect(welcomeB.objects.map((o) => o.id)).toEqual(['item-a', 'item-b']);
    expect(connA.jsonByType('participant_join')).toHaveLength(1);
  });

  it('late join sees moved state, not initial state (critical test #2)', () => {
    const { room, joinAs } = setup();
    const [a] = joinAs('ada');

    room.handleBinary(a, encode('OwnershipRequest', { objectId: 0, intent: 0 }));
    const grantConn = new RecordingConn();
    // Read the epoch from the object state the server holds.
    const epoch = room.objectState(0)!.epoch;
    room.handleBinary(
      a,
      encode('TransformUpdate', {
        objectId: 0,
        epoch,
        position: { x: 3, y: 1.5, z: 1 },
        rotation: identity,
        flags: 0,
      }),
    );
    room.handleBinary(
      a,
      encode('OwnershipRelease', {
        objectId: 0,
        epoch,
        finalPosition: { x: 3, y: 1.5, z: 1 },
        finalRotation: identity,
      }),
    );

    const late = room.join(grantConn, { handle: 'late', role: 'viewer' });
    const snap = grantConn.jsonByType('welcome')[0] as {
      selfIndex: number;
      objects: { position: number[]; holder: number | null }[];
    };
    expect(snap.selfIndex).toBe(late);
    expect(snap.objects[0]!.position[0]).toBeCloseTo(3, 2);
    expect(snap.objects[0]!.holder).toBeNull();
  });

  it('resync returns a full snapshot', () => {
    const { room, joinAs } = setup();
    const [a, connA] = joinAs('ada');
    room.handleJson(a, { type: 'resync' });
    expect(connA.jsonByType('snapshot')).toHaveLength(1);
  });
});

describe('ownership (critical test #1: contention)', () => {
  it('grants exactly one holder when two participants grab the same object', () => {
    const { room, joinAs } = setup();
    const [a, connA] = joinAs('ada');
    const [b, connB] = joinAs('sam');

    room.handleBinary(a, encode('OwnershipRequest', { objectId: 0, intent: 0 }));
    room.handleBinary(b, encode('OwnershipRequest', { objectId: 0, intent: 0 }));

    const grantsA = connA.byName('OwnershipGrant');
    expect(grantsA).toHaveLength(1);
    expect(grantsA[0]!.body.holderId).toBe(a);

    const denials = connB.jsonByType('denied');
    expect(denials).toHaveLength(1);
    expect((denials[0] as { reason: string }).reason).toBe('held');
    expect(room.objectState(0)!.holder).toBe(a);
  });

  it('increments the epoch on every grant', () => {
    const { room, joinAs } = setup();
    const [a] = joinAs('ada');
    const [b] = joinAs('sam');

    room.handleBinary(a, encode('OwnershipRequest', { objectId: 0, intent: 0 }));
    const e1 = room.objectState(0)!.epoch;
    room.handleBinary(
      a,
      encode('OwnershipRelease', {
        objectId: 0,
        epoch: e1,
        finalPosition: { x: 0, y: 1.2, z: -2 },
        finalRotation: identity,
      }),
    );
    room.handleBinary(b, encode('OwnershipRequest', { objectId: 0, intent: 0 }));
    expect(room.objectState(0)!.epoch).toBe(e1 + 1);
  });

  it('drops a transform carrying a stale epoch', () => {
    const { room, joinAs } = setup();
    const [a] = joinAs('ada');
    const [, connB] = joinAs('sam');

    room.handleBinary(a, encode('OwnershipRequest', { objectId: 0, intent: 0 }));
    const epoch = room.objectState(0)!.epoch;

    room.handleBinary(
      a,
      encode('TransformUpdate', {
        objectId: 0,
        epoch: epoch - 1, // stale
        position: { x: 9, y: 9, z: 9 },
        rotation: identity,
        flags: 0,
      }),
    );

    expect(connB.byName('TransformUpdate')).toHaveLength(0);
    expect(room.objectState(0)!.position.x).toBeCloseTo(0, 2);
    expect(room.stats(a)!.droppedTransforms).toBe(1);
  });

  it('expires a lease that stops renewing and releases the object', () => {
    const { room, clock, joinAs } = setup();
    const [a] = joinAs('ada');
    const [, connB] = joinAs('sam');

    room.handleBinary(a, encode('OwnershipRequest', { objectId: 0, intent: 0 }));
    expect(room.objectState(0)!.holder).toBe(a);

    clock.advance(6000);
    room.tick();

    expect(room.objectState(0)!.holder).toBeNull();
    expect(connB.byName('OwnershipRelease')).toHaveLength(1);
  });

  it('releases held objects when the holder disconnects', () => {
    const { room, joinAs } = setup();
    const [a] = joinAs('ada');
    const [, connB] = joinAs('sam');

    room.handleBinary(a, encode('OwnershipRequest', { objectId: 0, intent: 0 }));
    room.leave(a);

    expect(room.objectState(0)!.holder).toBeNull();
    expect(connB.byName('OwnershipRelease')).toHaveLength(1);
    expect(connB.jsonByType('participant_leave')).toHaveLength(1);
  });
});

describe('permission enforcement over realtime (critical test #3)', () => {
  it('denies a viewer ownership and counts it', () => {
    const { room, joinAs } = setup();
    const [v, connV] = joinAs('viewer', 'viewer');

    room.handleBinary(v, encode('OwnershipRequest', { objectId: 0, intent: 0 }));

    const denial = connV.jsonByType('denied')[0] as { reason: string };
    expect(denial.reason).toBe('role');
    expect(room.objectState(0)!.holder).toBeNull();
    expect(room.stats(v)!.deniedOwnership).toBe(1);
  });

  it('drops a transform from someone who holds nothing', () => {
    const { room, joinAs } = setup();
    const [v] = joinAs('viewer', 'viewer');
    const [, connB] = joinAs('sam');

    room.handleBinary(
      v,
      encode('TransformUpdate', {
        objectId: 0,
        epoch: 0,
        position: { x: 5, y: 1, z: 5 },
        rotation: identity,
        flags: 0,
      }),
    );

    expect(connB.byName('TransformUpdate')).toHaveLength(0);
    expect(room.objectState(0)!.position.x).toBeCloseTo(0, 2);
  });
});

describe('pose integrity', () => {
  it('overwrites a spoofed participantId with the server-assigned index (T4)', () => {
    const { room, joinAs } = setup();
    const [a] = joinAs('ada');
    const [b, connB] = joinAs('sam');

    room.handleBinary(a, pose(b /* claims to be sam */, 0.5));

    const relayed = connB.byName('PoseUpdate');
    expect(relayed).toHaveLength(1);
    expect(relayed[0]!.body.participantId).toBe(a);
  });

  it('drops implausibly fast movement (T6)', () => {
    const { room, clock, joinAs } = setup();
    const [a] = joinAs('ada');
    const [, connB] = joinAs('sam');

    room.handleBinary(a, pose(a, 0));
    clock.advance(50);
    room.handleBinary(a, pose(a, 20)); // 20 m in 50 ms = 400 m/s

    expect(connB.byName('PoseUpdate')).toHaveLength(1); // only the first
    expect(room.stats(a)!.poseViolations).toBe(1);

    // Normal movement afterwards still relays.
    clock.advance(50);
    room.handleBinary(a, pose(a, 0.05));
    expect(connB.byName('PoseUpdate')).toHaveLength(2);
  });

  it('survives garbage bytes without crashing and counts them', () => {
    const { room, joinAs } = setup();
    const [a] = joinAs('ada');

    room.handleBinary(a, new Uint8Array([1, 2, 3]));
    room.handleBinary(a, new Uint8Array(0));
    room.handleBinary(a, new Uint8Array([255, 255, 255, 255, 0, 0]));

    expect(room.stats(a)!.malformedPackets).toBe(3);
  });
});
