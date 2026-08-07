/**
 * Schema-driven binary codec.
 *
 * Encoding and decoding are both table-walks over MESSAGES, so a field added to the
 * schema is automatically handled here and in the generated C# — there is no
 * hand-written per-message serializer to fall out of sync.
 */

import {
  FIELD_SIZES,
  HEADER_SIZE,
  MESSAGES,
  PROTOCOL_VERSION,
  messageById,
  messageByName,
  payloadSize,
  type FieldDef,
  type MessageDef,
} from './schema.js';
import {
  DEFAULT_BOUNDS,
  dequantizeAxis,
  packQuat,
  quantizeAxis,
  unpackQuat,
  type Bounds,
  type Quat,
  type Vec3,
} from './quantize.js';

export type FieldValue = number | Vec3 | Quat;
export type MessageBody = Record<string, FieldValue>;

export interface DecodedMessage {
  readonly name: string;
  readonly id: number;
  readonly body: MessageBody;
}

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_message'
      | 'version_mismatch'
      | 'truncated'
      | 'length_mismatch'
      | 'missing_field'
      | 'bad_field',
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

function isVec3(v: FieldValue): v is Vec3 {
  return typeof v === 'object' && v !== null && 'x' in v && 'y' in v && 'z' in v && !('w' in v);
}

function isQuat(v: FieldValue): v is Quat {
  return typeof v === 'object' && v !== null && 'w' in v;
}

function writeField(
  view: DataView,
  offset: number,
  field: FieldDef,
  value: FieldValue,
  bounds: Bounds,
): number {
  switch (field.kind) {
    case 'u8':
      if (typeof value !== 'number')
        throw new ProtocolError(`${field.name}: expected number`, 'bad_field');
      view.setUint8(offset, value & 0xff);
      return offset + 1;
    case 'u16':
      if (typeof value !== 'number')
        throw new ProtocolError(`${field.name}: expected number`, 'bad_field');
      view.setUint16(offset, value & 0xffff, true);
      return offset + 2;
    case 'u32':
      if (typeof value !== 'number')
        throw new ProtocolError(`${field.name}: expected number`, 'bad_field');
      view.setUint32(offset, value >>> 0, true);
      return offset + 4;
    case 'i16':
      if (typeof value !== 'number')
        throw new ProtocolError(`${field.name}: expected number`, 'bad_field');
      view.setInt16(offset, value, true);
      return offset + 2;
    case 'f32':
      if (typeof value !== 'number')
        throw new ProtocolError(`${field.name}: expected number`, 'bad_field');
      view.setFloat32(offset, value, true);
      return offset + 4;
    case 'vec3q': {
      if (!isVec3(value)) throw new ProtocolError(`${field.name}: expected Vec3`, 'bad_field');
      view.setUint16(offset, quantizeAxis(value.x, bounds.min.x, bounds.max.x), true);
      view.setUint16(offset + 2, quantizeAxis(value.y, bounds.min.y, bounds.max.y), true);
      view.setUint16(offset + 4, quantizeAxis(value.z, bounds.min.z, bounds.max.z), true);
      return offset + 6;
    }
    case 'quat32': {
      if (!isQuat(value)) throw new ProtocolError(`${field.name}: expected Quat`, 'bad_field');
      view.setUint32(offset, packQuat(value), true);
      return offset + 4;
    }
  }
}

function readField(
  view: DataView,
  offset: number,
  field: FieldDef,
  bounds: Bounds,
): [FieldValue, number] {
  switch (field.kind) {
    case 'u8':
      return [view.getUint8(offset), offset + 1];
    case 'u16':
      return [view.getUint16(offset, true), offset + 2];
    case 'u32':
      return [view.getUint32(offset, true), offset + 4];
    case 'i16':
      return [view.getInt16(offset, true), offset + 2];
    case 'f32':
      return [view.getFloat32(offset, true), offset + 4];
    case 'vec3q': {
      const v: Vec3 = {
        x: dequantizeAxis(view.getUint16(offset, true), bounds.min.x, bounds.max.x),
        y: dequantizeAxis(view.getUint16(offset + 2, true), bounds.min.y, bounds.max.y),
        z: dequantizeAxis(view.getUint16(offset + 4, true), bounds.min.z, bounds.max.z),
      };
      return [v, offset + 6];
    }
    case 'quat32':
      return [unpackQuat(view.getUint32(offset, true)), offset + 4];
  }
}

/**
 * Header layout (4 bytes, docs/gearbox/05-realtime.md §5.4):
 *   u8  protocolVersion
 *   u8  messageType
 *   u16 payloadLength
 */
export function encode(
  name: string,
  body: MessageBody,
  bounds: Bounds = DEFAULT_BOUNDS,
): Uint8Array {
  const def = messageByName(name);
  if (!def) throw new ProtocolError(`Unknown message "${name}"`, 'unknown_message');

  const size = payloadSize(def);
  const buf = new ArrayBuffer(HEADER_SIZE + size);
  const view = new DataView(buf);

  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, def.id);
  view.setUint16(2, size, true);

  let offset = HEADER_SIZE;
  for (const field of def.fields) {
    const value = body[field.name];
    if (value === undefined) {
      throw new ProtocolError(
        `Message "${name}" is missing field "${field.name}"`,
        'missing_field',
      );
    }
    offset = writeField(view, offset, field, value, bounds);
  }

  return new Uint8Array(buf);
}

export function decode(bytes: Uint8Array, bounds: Bounds = DEFAULT_BOUNDS): DecodedMessage {
  if (bytes.byteLength < HEADER_SIZE) {
    throw new ProtocolError('Packet shorter than header', 'truncated');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = view.getUint8(0);
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      `Protocol version mismatch: peer ${version}, local ${PROTOCOL_VERSION}`,
      'version_mismatch',
    );
  }

  const id = view.getUint8(1);
  const def = messageById(id);
  if (!def) throw new ProtocolError(`Unknown message id 0x${id.toString(16)}`, 'unknown_message');

  const declaredLen = view.getUint16(2, true);
  const expected = payloadSize(def);
  if (declaredLen !== expected) {
    throw new ProtocolError(
      `${def.name}: declared payload ${declaredLen}, schema expects ${expected}`,
      'length_mismatch',
    );
  }
  if (bytes.byteLength < HEADER_SIZE + expected) {
    throw new ProtocolError(`${def.name}: truncated payload`, 'truncated');
  }

  const body: MessageBody = {};
  let offset = HEADER_SIZE;
  for (const field of def.fields) {
    const [value, next] = readField(view, offset, field, bounds);
    body[field.name] = value;
    offset = next;
  }

  return { name: def.name, id, body };
}

/** Total encoded size for a message, used for bandwidth budgeting and tests. */
export function encodedSize(def: MessageDef): number {
  return HEADER_SIZE + payloadSize(def);
}

/** Per-message wire sizes — handy in tests and in the bandwidth budget docs. */
export function wireSizeTable(): Record<string, number> {
  return Object.fromEntries(MESSAGES.map((m) => [m.name, encodedSize(m)]));
}

export { FIELD_SIZES };
