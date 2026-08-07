/**
 * THE WIRE SCHEMA — single source of truth for the realtime protocol.
 *
 * Both the TypeScript codec and the generated C# structs are derived from this table.
 * Nothing about the wire format is written twice, because schema drift between client
 * and server is the highest-frequency bug class in multiplayer code
 * (docs/gearbox/03-architecture.md §3.5 rule 1).
 *
 * To change the wire format: edit this file, run `pnpm codegen`, commit the generated
 * C#. CI fails if the generated output is stale.
 */

/** Bumped on any breaking change. Negotiated at session join; mismatch is refused. */
export const PROTOCOL_VERSION = 1;

/** Wire field kinds. Sizes are fixed and known at schema-compile time. */
export type FieldKind =
  | 'u8' // 1 byte
  | 'u16' // 2 bytes
  | 'u32' // 4 bytes
  | 'i16' // 2 bytes
  | 'f32' // 4 bytes
  | 'vec3q' // 6 bytes — position quantized into the session's declared bounds
  | 'quat32'; // 4 bytes — smallest-three quaternion

export const FIELD_SIZES: Readonly<Record<FieldKind, number>> = Object.freeze({
  u8: 1,
  u16: 2,
  u32: 4,
  i16: 2,
  f32: 4,
  vec3q: 6,
  quat32: 4,
});

export interface FieldDef {
  readonly name: string;
  readonly kind: FieldKind;
  /** Human note carried into the generated C# as a doc comment. */
  readonly doc?: string;
}

export interface MessageDef {
  readonly name: string;
  /** Stable wire discriminator. Never reuse an id, even after deleting a message. */
  readonly id: number;
  readonly channel: ChannelName;
  readonly fields: readonly FieldDef[];
  readonly doc?: string;
}

export type ChannelName =
  'POSE' | 'TRANSFORM' | 'POINTER' | 'EVENT' | 'SNAPSHOT' | 'CONTROL' | 'GEO';

export interface ChannelDef {
  readonly name: ChannelName;
  readonly reliable: boolean;
  readonly ordered: boolean;
  /** Nominal send rate in Hz; 0 means event-driven. */
  readonly rateHz: number;
  readonly doc: string;
}

/** docs/gearbox/05-realtime.md §5.3 */
export const CHANNELS: readonly ChannelDef[] = Object.freeze([
  {
    name: 'POSE',
    reliable: false,
    ordered: false,
    rateHz: 20,
    doc: 'Head/hand/root pose. Loss is fine; delay is not.',
  },
  {
    name: 'TRANSFORM',
    reliable: false,
    ordered: false,
    rateHz: 20,
    doc: 'Leased object transforms while held.',
  },
  {
    name: 'POINTER',
    reliable: false,
    ordered: false,
    rateHz: 10,
    doc: 'Ray/pointer and selection highlight.',
  },
  {
    name: 'EVENT',
    reliable: true,
    ordered: true,
    rateHz: 0,
    doc: 'Spawn/delete/pin, ownership, app and permission events.',
  },
  {
    name: 'SNAPSHOT',
    reliable: true,
    ordered: true,
    rateHz: 0,
    doc: 'Full or delta room state on join/resync.',
  },
  {
    name: 'CONTROL',
    reliable: true,
    ordered: true,
    rateHz: 0,
    doc: 'Version negotiation, resync, migrate, error, kick.',
  },
  {
    name: 'GEO',
    reliable: true,
    ordered: true,
    rateHz: 1,
    doc: 'Outdoor cell digests — city-scale presence (docs/gearbox/11-geospatial-mvp.md §11.5).',
  },
]);

/**
 * Message table.
 *
 * Participant and object ids on the wire are session-local indices, not UUIDs: sending
 * 16-byte UUIDs at 20 Hz wastes roughly 40% of each packet. The index↔UUID mapping
 * ships in the snapshot (docs/gearbox/05-realtime.md §5.4).
 */
export const MESSAGES: readonly MessageDef[] = Object.freeze([
  {
    name: 'PoseUpdate',
    id: 0x10,
    channel: 'POSE',
    doc: 'One participant’s body pose for a single tick.',
    fields: [
      { name: 'participantId', kind: 'u16' },
      { name: 'tickSeq', kind: 'u32' },
      { name: 'headPos', kind: 'vec3q' },
      { name: 'headRot', kind: 'quat32' },
      { name: 'leftHandPos', kind: 'vec3q' },
      { name: 'leftHandRot', kind: 'quat32' },
      { name: 'rightHandPos', kind: 'vec3q' },
      { name: 'rightHandRot', kind: 'quat32' },
      {
        name: 'trackingFlags',
        kind: 'u8',
        doc: 'bit0 handsValid, bit1 eyeValid, bit2 muted, bits3-5 presenceMode',
      },
      {
        name: 'voiceAmplitude',
        kind: 'u8',
        doc: 'Drives mouth movement without decoding the audio stream.',
      },
    ],
  },
  {
    name: 'TransformUpdate',
    id: 0x11,
    channel: 'TRANSFORM',
    doc: 'Streamed while an ownership lease is held. Stale epochs are dropped.',
    fields: [
      { name: 'objectId', kind: 'u32' },
      { name: 'epoch', kind: 'u16', doc: 'Lease epoch; increments on every grant.' },
      { name: 'position', kind: 'vec3q' },
      { name: 'rotation', kind: 'quat32' },
      { name: 'flags', kind: 'u8' },
    ],
  },
  {
    name: 'PointerUpdate',
    id: 0x12,
    channel: 'POINTER',
    fields: [
      { name: 'participantId', kind: 'u16' },
      { name: 'origin', kind: 'vec3q' },
      { name: 'direction', kind: 'quat32' },
      { name: 'targetObjectId', kind: 'u32' },
      { name: 'flags', kind: 'u8' },
    ],
  },
  {
    name: 'OwnershipRequest',
    id: 0x20,
    channel: 'EVENT',
    fields: [
      { name: 'objectId', kind: 'u32' },
      { name: 'intent', kind: 'u8', doc: '0 grab, 1 seat, 2 edit' },
    ],
  },
  {
    name: 'OwnershipGrant',
    id: 0x21,
    channel: 'EVENT',
    fields: [
      { name: 'objectId', kind: 'u32' },
      { name: 'holderId', kind: 'u16' },
      { name: 'epoch', kind: 'u16' },
      { name: 'leaseMs', kind: 'u16' },
    ],
  },
  {
    name: 'OwnershipRelease',
    id: 0x22,
    channel: 'EVENT',
    fields: [
      { name: 'objectId', kind: 'u32' },
      { name: 'epoch', kind: 'u16' },
      { name: 'finalPosition', kind: 'vec3q' },
      { name: 'finalRotation', kind: 'quat32' },
    ],
  },
  {
    name: 'ResyncRequest',
    id: 0x30,
    channel: 'CONTROL',
    doc: 'Client detected divergence; server replies with a full snapshot.',
    fields: [{ name: 'lastAppliedSeq', kind: 'u32' }],
  },
  {
    name: 'GeoCellDigest',
    id: 0x40,
    channel: 'GEO',
    doc: 'Outdoor presence. Counts only — never other players’ exact positions (§11.8).',
    fields: [
      { name: 'cellLow', kind: 'u32', doc: 'H3 res-9 index, low 32 bits' },
      { name: 'cellHigh', kind: 'u32', doc: 'H3 res-9 index, high 32 bits' },
      { name: 'playerCount', kind: 'u16' },
      { name: 'activePlaceCount', kind: 'u16' },
    ],
  },
]);

const seenIds = new Set<number>();
for (const m of MESSAGES) {
  if (seenIds.has(m.id)) throw new Error(`Duplicate message id 0x${m.id.toString(16)}`);
  seenIds.add(m.id);
}

export function messageById(id: number): MessageDef | undefined {
  return MESSAGES.find((m) => m.id === id);
}

export function messageByName(name: string): MessageDef | undefined {
  return MESSAGES.find((m) => m.name === name);
}

/** Payload size in bytes, excluding the 4-byte header. */
export function payloadSize(def: MessageDef): number {
  return def.fields.reduce((n, f) => n + FIELD_SIZES[f.kind], 0);
}

export const HEADER_SIZE = 4;
