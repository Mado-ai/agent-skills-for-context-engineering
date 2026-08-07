/**
 * The viewer's multiplayer session.
 *
 * Two modes, one code path:
 *
 *  - `?server=ws://host:7777/rooms/demo` — a live session against the room-server.
 *  - no server param — a simulated session: the REAL AuthoritativeRoom from
 *    @gearbox/room-core runs in-page, and two scripted participants join it as
 *    ordinary clients. Every pose and grab still round-trips through the real wire
 *    codec and the real authority rules; only the socket is missing. (The published
 *    artifact can never reach a network — its CSP blocks external hosts — so the
 *    simulation is what makes the social layer demonstrable there, and it is labeled
 *    as simulated in the UI rather than passed off as live.)
 */

import { decode, encode, type Quat, type Vec3 } from '@gearbox/protocol';
import {
  AuthoritativeRoom,
  type ObjectSpec,
  type RoomConnection,
  type Role,
  type ServerMessage,
  type SnapshotMessage,
} from '@gearbox/room-core';
import {
  InterpolationBuffer,
  connectWebSocket,
  type AvatarPose,
  type ClientLink,
} from '@gearbox/networking-sdk';

export interface LocalPose {
  head: { position: Vec3; rotation: Quat };
  leftHand: { position: Vec3; rotation: Quat };
  rightHand: { position: Vec3; rotation: Quat };
  handsValid: boolean;
}

export interface SessionCallbacks {
  onPresence(count: number, simulated: boolean): void;
  onRemoteJoin(index: number, handle: string): void;
  onRemoteLeave(index: number): void;
  /** A remote transform stream for an object someone else is holding. */
  onObjectTransform(objectIndex: number, position: Vec3, rotation: Quat): void;
  onObjectGrant(objectIndex: number, holderIndex: number): void;
  onObjectRelease(objectIndex: number, finalPosition: Vec3, finalRotation: Quat): void;
  /** The server refused our grab — undo the optimistic hold. */
  onOwnershipDenied(objectIndex: number): void;
  /** WebRTC signaling from a peer (voice). */
  onRtc?(fromIndex: number, payload: unknown): void;
}

const SEND_HZ = 20;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;

interface RemoteState {
  handle: string;
  buffer: InterpolationBuffer;
}

export class RoomSession {
  readonly simulated: boolean;
  private readonly link: ClientLink;
  private readonly callbacks: SessionCallbacks;
  private readonly remotes = new Map<number, RemoteState>();
  private readonly holders = new Map<number, number>(); // objectIndex → participant index
  private readonly epochs = new Map<number, number>(); // objectIndex → current epoch
  /** snapshot object id → object index, so the client never guesses the mapping. */
  readonly objectIndexById = new Map<string, number>();

  private selfIndex = -1;
  private tickSeq = 0;
  private sendAccumulator = 0;
  private transformAccumulator = 0;
  private readonly sim: SimulatedPeers | null;

  private constructor(
    link: ClientLink,
    callbacks: SessionCallbacks,
    simulated: boolean,
    sim: SimulatedPeers | null,
  ) {
    this.link = link;
    this.callbacks = callbacks;
    this.simulated = simulated;
    this.sim = sim;
    link.onJson((message) => this.onJson(message as ServerMessage));
    link.onBinary((bytes) => this.onBinary(bytes));
  }

  /** Live session against a room-server URL. */
  static async connect(url: string, callbacks: SessionCallbacks): Promise<RoomSession> {
    const link = await connectWebSocket(url);
    return new RoomSession(link, callbacks, false, null);
  }

  /** Simulated session: the real room, in-page, with two scripted peers. */
  static simulatedSession(objects: ObjectSpec[], callbacks: SessionCallbacks): RoomSession {
    const room = new AuthoritativeRoom(objects);
    const link = directLink(room, 'you', 'owner');
    const session = new RoomSession(link, callbacks, true, new SimulatedPeers(room));
    return session;
  }

  get self(): number {
    return this.selfIndex;
  }

  remoteIndices(): number[] {
    return [...this.remotes.keys()];
  }

  sendRtc(to: number, payload: unknown): void {
    this.link.sendJson({ type: 'rtc', to, payload });
  }

  isHeldRemotely(objectIndex: number): boolean {
    const holder = this.holders.get(objectIndex);
    return holder !== undefined && holder !== this.selfIndex;
  }

  requestOwnership(objectIndex: number): void {
    this.link.send(encode('OwnershipRequest', { objectId: objectIndex, intent: 0 }));
  }

  releaseOwnership(objectIndex: number, position: Vec3, rotation: Quat): void {
    const epoch = this.epochs.get(objectIndex);
    if (epoch === undefined) return;
    this.link.send(
      encode('OwnershipRelease', {
        objectId: objectIndex,
        epoch,
        finalPosition: position,
        finalRotation: rotation,
      }),
    );
    this.holders.delete(objectIndex);
  }

  /** Streamed while holding; throttled to the pose rate. */
  sendHeldTransform(objectIndex: number, position: Vec3, rotation: Quat): void {
    if (this.transformAccumulator < SEND_INTERVAL_MS) return;
    this.transformAccumulator = 0;
    const epoch = this.epochs.get(objectIndex);
    if (epoch === undefined || this.holders.get(objectIndex) !== this.selfIndex) return;
    this.link.send(
      encode('TransformUpdate', { objectId: objectIndex, epoch, position, rotation, flags: 0 }),
    );
  }

  sampleRemote(index: number, nowMs: number): AvatarPose | null {
    return this.remotes.get(index)?.buffer.sample(nowMs) ?? null;
  }

  update(dtMs: number, nowMs: number, localPose: LocalPose): void {
    this.sendAccumulator += dtMs;
    this.transformAccumulator += dtMs;
    this.sim?.step(dtMs, nowMs);

    if (this.sendAccumulator >= SEND_INTERVAL_MS && this.selfIndex >= 0) {
      this.sendAccumulator = 0;
      this.link.send(
        encode('PoseUpdate', {
          participantId: this.selfIndex,
          tickSeq: this.tickSeq++,
          headPos: localPose.head.position,
          headRot: localPose.head.rotation,
          leftHandPos: localPose.leftHand.position,
          leftHandRot: localPose.leftHand.rotation,
          rightHandPos: localPose.rightHand.position,
          rightHandRot: localPose.rightHand.rotation,
          trackingFlags: localPose.handsValid ? 1 : 0,
          voiceAmplitude: 0,
        }),
      );
    }
  }

  close(): void {
    this.link.close();
  }

  // ── inbound ───────────────────────────────────────────────────────────────

  private onJson(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
      case 'snapshot':
        this.applySnapshot(message);
        break;
      case 'participant_join':
        this.remotes.set(message.index, {
          handle: message.handle,
          buffer: new InterpolationBuffer(),
        });
        this.callbacks.onRemoteJoin(message.index, message.handle);
        this.emitPresence();
        break;
      case 'participant_leave':
        this.remotes.delete(message.index);
        this.callbacks.onRemoteLeave(message.index);
        this.emitPresence();
        break;
      case 'denied':
        if (message.action === 'ownership') this.callbacks.onOwnershipDenied(message.objectId);
        break;
      case 'rtc':
        this.callbacks.onRtc?.(message.from, message.payload);
        break;
      case 'error':
        break;
    }
  }

  private applySnapshot(snapshot: SnapshotMessage): void {
    this.selfIndex = snapshot.selfIndex;
    for (const p of snapshot.participants) {
      if (p.index === this.selfIndex || this.remotes.has(p.index)) continue;
      this.remotes.set(p.index, { handle: p.handle, buffer: new InterpolationBuffer() });
      this.callbacks.onRemoteJoin(p.index, p.handle);
    }
    for (const o of snapshot.objects) {
      this.objectIndexById.set(o.id, o.index);
      this.epochs.set(o.index, o.epoch);
      if (o.holder !== null) {
        this.holders.set(o.index, o.holder);
        if (o.holder !== this.selfIndex) this.callbacks.onObjectGrant(o.index, o.holder);
      }
      this.callbacks.onObjectTransform(
        o.index,
        { x: o.position[0], y: o.position[1], z: o.position[2] },
        { x: o.rotation[0], y: o.rotation[1], z: o.rotation[2], w: o.rotation[3] },
      );
    }
    this.emitPresence();
  }

  private onBinary(bytes: Uint8Array): void {
    let msg;
    try {
      msg = decode(bytes);
    } catch {
      return;
    }

    switch (msg.name) {
      case 'PoseUpdate': {
        const b = msg.body as unknown as {
          participantId: number;
          headPos: Vec3;
          headRot: Quat;
          leftHandPos: Vec3;
          leftHandRot: Quat;
          rightHandPos: Vec3;
          rightHandRot: Quat;
          trackingFlags: number;
          voiceAmplitude: number;
        };
        const remote = this.remotes.get(b.participantId);
        remote?.buffer.push(performance.now(), {
          head: { position: b.headPos, rotation: b.headRot },
          leftHand: { position: b.leftHandPos, rotation: b.leftHandRot },
          rightHand: { position: b.rightHandPos, rotation: b.rightHandRot },
          handsValid: (b.trackingFlags & 1) === 1,
          voiceAmplitude: b.voiceAmplitude,
        });
        break;
      }
      case 'TransformUpdate': {
        const b = msg.body as unknown as { objectId: number; position: Vec3; rotation: Quat };
        if (this.isHeldRemotely(b.objectId)) {
          this.callbacks.onObjectTransform(b.objectId, b.position, b.rotation);
        }
        break;
      }
      case 'OwnershipGrant': {
        const b = msg.body as unknown as { objectId: number; holderId: number; epoch: number };
        this.holders.set(b.objectId, b.holderId);
        this.epochs.set(b.objectId, b.epoch);
        if (b.holderId !== this.selfIndex) this.callbacks.onObjectGrant(b.objectId, b.holderId);
        break;
      }
      case 'OwnershipRelease': {
        const b = msg.body as unknown as {
          objectId: number;
          epoch: number;
          finalPosition: Vec3;
          finalRotation: Quat;
        };
        const wasRemote = this.isHeldRemotely(b.objectId);
        this.holders.delete(b.objectId);
        this.epochs.set(b.objectId, b.epoch);
        if (wasRemote) {
          this.callbacks.onObjectRelease(b.objectId, b.finalPosition, b.finalRotation);
        }
        break;
      }
      default:
        break;
    }
  }

  private emitPresence(): void {
    this.callbacks.onPresence(this.remotes.size + 1, this.simulated);
  }
}

// ── in-page room plumbing ───────────────────────────────────────────────────

/**
 * A ClientLink wired straight to an in-page AuthoritativeRoom. Delivery is deferred a
 * microtask so message ordering matches a real transport (handlers never re-enter).
 */
function directLink(room: AuthoritativeRoom, handle: string, role: Role): ClientLink {
  const binaryCbs: Array<(b: Uint8Array) => void> = [];
  const jsonCbs: Array<(m: unknown) => void> = [];

  const conn: RoomConnection = {
    sendBinary: (bytes) => queueMicrotask(() => binaryCbs.forEach((cb) => cb(bytes))),
    sendJson: (message) => queueMicrotask(() => jsonCbs.forEach((cb) => cb(message))),
  };
  const index = room.join(conn, { handle, role });

  return {
    send: (bytes) => room.handleBinary(index, bytes),
    sendJson: (message) => room.handleJson(index, message),
    onBinary: (cb) => binaryCbs.push(cb),
    onJson: (cb) => jsonCbs.push(cb),
    onClose: () => {},
    close: () => room.leave(index),
  };
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

interface PeerScript {
  readonly handle: string;
  readonly center: { x: number; z: number };
  readonly radius: number;
  readonly speed: number;
  readonly phase: number;
  /** Object this peer periodically picks up, or null. */
  readonly grabsObject: number | null;
  link: ClientLink;
  index: number;
  tickSeq: number;
  accumulator: number;
  grabEpoch: number | null;
  grabbing: boolean;
}

/**
 * Two scripted participants. They are ordinary clients of the same room: their poses
 * are speed-checked, their grabs go through leases, and a real player in a live
 * session would collide with their ownership exactly as with a human's.
 */
class SimulatedPeers {
  private readonly peers: PeerScript[];

  constructor(room: AuthoritativeRoom) {
    const specs = [
      {
        handle: '@sam',
        center: { x: -2.1, z: -0.5 },
        radius: 0.55,
        speed: 0.35,
        phase: 0,
        grabsObject: null,
      },
      {
        handle: '@mira',
        center: { x: 2.1, z: -0.7 },
        radius: 0.6,
        speed: 0.28,
        phase: Math.PI,
        grabsObject: 4, // the prism — far from the player's spawn
      },
    ];

    this.peers = specs.map((spec) => {
      const peer: PeerScript = {
        ...spec,
        link: null as unknown as ClientLink,
        index: -1,
        tickSeq: 0,
        accumulator: 0,
        grabEpoch: null,
        grabbing: false,
      };
      peer.link = directLink(room, spec.handle, 'collaborator');
      peer.link.onJson((m) => {
        const msg = m as SnapshotMessage;
        if (msg.type === 'welcome') peer.index = msg.selfIndex;
      });
      peer.link.onBinary((bytes) => {
        try {
          const msg = decode(bytes);
          if (msg.name === 'OwnershipGrant') {
            const b = msg.body as unknown as { objectId: number; holderId: number; epoch: number };
            if (b.holderId === peer.index) peer.grabEpoch = b.epoch;
          }
        } catch {
          /* ignore */
        }
      });
      return peer;
    });
  }

  step(dtMs: number, nowMs: number): void {
    for (const peer of this.peers) {
      peer.accumulator += dtMs;
      if (peer.accumulator < SEND_INTERVAL_MS) continue;
      peer.accumulator = 0;

      const t = nowMs * 0.001 * peer.speed + peer.phase;
      const x = peer.center.x + Math.cos(t) * peer.radius;
      const z = peer.center.z + Math.sin(t) * peer.radius;
      // Face the walking direction.
      const yaw = Math.atan2(-Math.sin(t), Math.cos(t)) + Math.PI / 2;
      const head: Vec3 = { x, y: 1.52 + Math.sin(nowMs * 0.0021) * 0.02, z };
      const rot = yawQuat(yaw);
      const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };

      peer.link.send(
        encode('PoseUpdate', {
          participantId: peer.index,
          tickSeq: peer.tickSeq++,
          headPos: head,
          headRot: rot,
          leftHandPos: { x: x - side.x * 0.22, y: 1.05, z: z - side.z * 0.22 },
          leftHandRot: rot,
          rightHandPos: { x: x + side.x * 0.22, y: 1.05, z: z + side.z * 0.22 },
          rightHandRot: rot,
          trackingFlags: 1,
          voiceAmplitude: 0,
        }),
      );

      if (peer.grabsObject !== null) this.stepGrab(peer, nowMs);
    }
  }

  /** Every ~16 s: pick the object up, carry it in a small arc, put it back. */
  private stepGrab(peer: PeerScript, nowMs: number): void {
    const objectId = peer.grabsObject as number;
    const phase = (nowMs / 1000) % 16;
    const home: Vec3 = { x: 2.25, y: 1.26, z: -2.25 };

    if (phase >= 6 && phase < 10) {
      if (!peer.grabbing) {
        peer.grabbing = true;
        peer.grabEpoch = null;
        peer.link.send(encode('OwnershipRequest', { objectId, intent: 0 }));
      } else if (peer.grabEpoch !== null) {
        const k = (phase - 6) / 4;
        peer.link.send(
          encode('TransformUpdate', {
            objectId,
            epoch: peer.grabEpoch,
            position: {
              x: home.x - Math.sin(k * Math.PI) * 0.5,
              y: home.y + Math.sin(k * Math.PI) * 0.4,
              z: home.z + Math.sin(k * Math.PI * 2) * 0.15,
            },
            rotation: IDENTITY,
            flags: 0,
          }),
        );
      }
    } else if (peer.grabbing) {
      peer.grabbing = false;
      if (peer.grabEpoch !== null) {
        peer.link.send(
          encode('OwnershipRelease', {
            objectId,
            epoch: peer.grabEpoch,
            finalPosition: home,
            finalRotation: IDENTITY,
          }),
        );
        peer.grabEpoch = null;
      }
    }
  }
}
