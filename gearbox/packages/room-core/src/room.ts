/**
 * The authoritative room (docs/gearbox/05-realtime.md §5.1, §5.5, §5.6).
 *
 * Server-authoritative rules implemented here, each with a test in room.test.ts:
 *  - ownership leases with epochs: exactly one holder; every grant increments the
 *    epoch; a transform carrying a stale epoch is dropped. This is what kills the
 *    "two clients think they hold it" race.
 *  - identity is server-stamped: the participantId a client writes into its own
 *    PoseUpdate is overwritten with the server's index before relay, so poses cannot
 *    be spoofed onto someone else's avatar (threat T4).
 *  - pose plausibility: a head that moves faster than MAX_SPEED_MPS between fixes is
 *    dropped, not relayed (threat T6).
 *  - permission over the realtime channel: a viewer's ownership request is denied and
 *    a viewer's transform is dropped — realtime authz is the one teams forget
 *    (docs/gearbox/10-quality-devops.md §10.1).
 *  - late join and resync get a full snapshot of current state, never a replay.
 */

import { decode, encode, ProtocolError, type Quat, type Vec3 } from '@gearbox/protocol';
import type {
  JoinInfo,
  ObjectSpec,
  ParticipantStats,
  RoomConnection,
  Role,
  ServerMessage,
  SnapshotMessage,
} from './types.js';

const LEASE_MS = 5000;
const MAX_SPEED_MPS = 10;
const MAX_EVENTS_PER_SEC = 100;

interface PoseBody {
  participantId: number;
  tickSeq: number;
  headPos: Vec3;
  headRot: Quat;
  leftHandPos: Vec3;
  leftHandRot: Quat;
  rightHandPos: Vec3;
  rightHandRot: Quat;
  trackingFlags: number;
  voiceAmplitude: number;
}

interface TransformBody {
  objectId: number;
  epoch: number;
  position: Vec3;
  rotation: Quat;
  flags: number;
}

interface OwnershipRequestBody {
  objectId: number;
  intent: number;
}

interface OwnershipReleaseBody {
  objectId: number;
  epoch: number;
  finalPosition: Vec3;
  finalRotation: Quat;
}

interface ObjectState {
  readonly index: number;
  readonly id: string;
  position: Vec3;
  rotation: Quat;
  epoch: number;
  holder: number | null;
  leaseExpiresAt: number;
}

interface Participant {
  readonly index: number;
  readonly handle: string;
  readonly role: Role;
  readonly conn: RoomConnection;
  lastHeadPos: Vec3 | null;
  lastPoseAt: number;
  eventsThisSecond: number;
  stats: ParticipantStats;
}

export class AuthoritativeRoom {
  private readonly participants = new Map<number, Participant>();
  private readonly objects: ObjectState[];
  private nextIndex = 0;
  private seq = 0;
  private lastRateReset: number;

  constructor(
    objects: readonly ObjectSpec[],
    private readonly now: () => number = () => Date.now(),
  ) {
    this.objects = objects.map((spec, index) => ({
      index,
      id: spec.id,
      position: { ...spec.position },
      rotation: { ...spec.rotation },
      epoch: 0,
      holder: null,
      leaseExpiresAt: 0,
    }));
    this.lastRateReset = this.now();
  }

  get participantCount(): number {
    return this.participants.size;
  }

  join(conn: RoomConnection, info: JoinInfo): number {
    const index = this.nextIndex++;
    const participant: Participant = {
      index,
      handle: info.handle,
      role: info.role,
      conn,
      lastHeadPos: null,
      lastPoseAt: 0,
      eventsThisSecond: 0,
      stats: { poseViolations: 0, droppedTransforms: 0, deniedOwnership: 0, malformedPackets: 0 },
    };
    this.participants.set(index, participant);

    conn.sendJson(this.snapshot(index, 'welcome'));
    this.broadcastJson(
      { type: 'participant_join', index, handle: info.handle, role: info.role },
      index,
    );
    return index;
  }

  leave(index: number): void {
    const participant = this.participants.get(index);
    if (!participant) return;

    // A disconnect must never leave an object stuck in a dead hand.
    for (const obj of this.objects) {
      if (obj.holder === index) this.releaseObject(obj, obj.position, obj.rotation);
    }

    this.participants.delete(index);
    this.broadcastJson({ type: 'participant_leave', index }, index);
  }

  handleJson(index: number, message: unknown): void {
    const participant = this.participants.get(index);
    if (!participant) return;
    const type = (message as { type?: string }).type;
    if (type === 'resync') {
      participant.conn.sendJson(this.snapshot(index, 'snapshot'));
    }
  }

  handleBinary(index: number, bytes: Uint8Array): void {
    const participant = this.participants.get(index);
    if (!participant) return;

    let name: string;
    let body: unknown;
    try {
      const msg = decode(bytes);
      name = msg.name;
      body = msg.body;
    } catch (err) {
      if (err instanceof ProtocolError) {
        participant.stats.malformedPackets++;
        return; // malformed input is dropped, never crashes the room
      }
      throw err;
    }

    switch (name) {
      case 'PoseUpdate':
        this.onPose(participant, body as PoseBody);
        break;
      case 'TransformUpdate':
        this.onTransform(participant, body as TransformBody);
        break;
      case 'OwnershipRequest':
        this.onOwnershipRequest(participant, body as OwnershipRequestBody);
        break;
      case 'OwnershipRelease':
        this.onOwnershipRelease(participant, body as OwnershipReleaseBody);
        break;
      default:
        // Clients do not send Grants or snapshots; ignore.
        break;
    }
  }

  /** Call at ~1 Hz: lease expiry and rate-counter reset. */
  tick(): void {
    const now = this.now();

    if (now - this.lastRateReset >= 1000) {
      for (const p of this.participants.values()) p.eventsThisSecond = 0;
      this.lastRateReset = now;
    }

    for (const obj of this.objects) {
      if (obj.holder !== null && now > obj.leaseExpiresAt) {
        // Two missed renewals: the lease dies and the object is released where it is.
        this.releaseObject(obj, obj.position, obj.rotation);
      }
    }
  }

  stats(index: number): ParticipantStats | null {
    return this.participants.get(index)?.stats ?? null;
  }

  objectState(objectId: number): {
    holder: number | null;
    epoch: number;
    position: Vec3;
  } | null {
    const obj = this.objects[objectId];
    return obj ? { holder: obj.holder, epoch: obj.epoch, position: { ...obj.position } } : null;
  }

  // ── message handlers ──────────────────────────────────────────────────────

  private onPose(participant: Participant, body: PoseBody): void {
    const now = this.now();

    if (participant.lastHeadPos !== null && participant.lastPoseAt > 0) {
      const dt = Math.max((now - participant.lastPoseAt) / 1000, 1 / 120);
      const d = distance(participant.lastHeadPos, body.headPos);
      if (d / dt > MAX_SPEED_MPS) {
        participant.stats.poseViolations++;
        return; // implausible motion is not relayed
      }
    }
    participant.lastHeadPos = { ...body.headPos };
    participant.lastPoseAt = now;

    // Identity is the server's to assert, not the client's.
    const relay = encode('PoseUpdate', {
      ...body,
      participantId: participant.index,
    } as unknown as Record<string, number | Vec3 | Quat>);
    this.broadcastBinary(relay, participant.index);
  }

  private onTransform(participant: Participant, body: TransformBody): void {
    const obj = this.objects[body.objectId];
    if (!obj || obj.holder !== participant.index || obj.epoch !== body.epoch) {
      participant.stats.droppedTransforms++;
      return;
    }

    obj.position = { ...body.position };
    obj.rotation = { ...body.rotation };
    obj.leaseExpiresAt = this.now() + LEASE_MS;

    this.broadcastBinary(
      encode('TransformUpdate', body as unknown as Record<string, number | Vec3 | Quat>),
      participant.index,
    );
  }

  private onOwnershipRequest(participant: Participant, body: OwnershipRequestBody): void {
    if (!this.allowEvent(participant)) return;

    const deny = (reason: 'role' | 'held' | 'unknown_object'): void => {
      participant.stats.deniedOwnership++;
      participant.conn.sendJson({
        type: 'denied',
        action: 'ownership',
        objectId: body.objectId,
        reason,
      });
    };

    if (participant.role === 'viewer') return deny('role');

    const obj = this.objects[body.objectId];
    if (!obj) return deny('unknown_object');

    const now = this.now();
    const heldByOther =
      obj.holder !== null && obj.holder !== participant.index && now <= obj.leaseExpiresAt;
    if (heldByOther) return deny('held');

    obj.holder = participant.index;
    obj.epoch = (obj.epoch + 1) & 0xffff;
    obj.leaseExpiresAt = now + LEASE_MS;
    this.seq++;

    // Grants broadcast to everyone — including the holder, who learns its epoch here.
    this.broadcastBinary(
      encode('OwnershipGrant', {
        objectId: obj.index,
        holderId: participant.index,
        epoch: obj.epoch,
        leaseMs: LEASE_MS,
      }),
      null,
    );
  }

  private onOwnershipRelease(participant: Participant, body: OwnershipReleaseBody): void {
    const obj = this.objects[body.objectId];
    if (!obj || obj.holder !== participant.index || obj.epoch !== body.epoch) return;
    this.releaseObject(obj, body.finalPosition, body.finalRotation);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private releaseObject(obj: ObjectState, finalPosition: Vec3, finalRotation: Quat): void {
    obj.position = { ...finalPosition };
    obj.rotation = { ...finalRotation };
    obj.holder = null;
    this.seq++;

    this.broadcastBinary(
      encode('OwnershipRelease', {
        objectId: obj.index,
        epoch: obj.epoch,
        finalPosition: obj.position,
        finalRotation: obj.rotation,
      }),
      null,
    );
  }

  private allowEvent(participant: Participant): boolean {
    participant.eventsThisSecond++;
    return participant.eventsThisSecond <= MAX_EVENTS_PER_SEC;
  }

  private snapshot(selfIndex: number, type: 'welcome' | 'snapshot'): SnapshotMessage {
    return {
      type,
      selfIndex,
      seq: this.seq,
      participants: [...this.participants.values()].map((p) => ({
        index: p.index,
        handle: p.handle,
        role: p.role,
      })),
      objects: this.objects.map((o) => ({
        index: o.index,
        id: o.id,
        position: [o.position.x, o.position.y, o.position.z],
        rotation: [o.rotation.x, o.rotation.y, o.rotation.z, o.rotation.w],
        epoch: o.epoch,
        holder: o.holder !== null && this.now() <= o.leaseExpiresAt ? o.holder : null,
      })),
    };
  }

  private broadcastBinary(bytes: Uint8Array, exceptIndex: number | null): void {
    for (const p of this.participants.values()) {
      if (p.index === exceptIndex) continue;
      p.conn.sendBinary(bytes);
    }
  }

  private broadcastJson(message: ServerMessage, exceptIndex: number | null): void {
    for (const p of this.participants.values()) {
      if (p.index === exceptIndex) continue;
      p.conn.sendJson(message);
    }
  }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
