import { describe, expect, it } from 'vitest';
import { MESSAGES, PROTOCOL_VERSION, payloadSize, HEADER_SIZE } from './schema.js';
import { decode, encode, encodedSize, ProtocolError, wireSizeTable } from './codec.js';
import {
  DEFAULT_BOUNDS,
  packQuat,
  positionPrecision,
  quatAngleBetween,
  unpackQuat,
  type Quat,
} from './quantize.js';

const identity: Quat = { x: 0, y: 0, z: 0, w: 1 };

function randomUnitQuat(rand: () => number): Quat {
  // Shoemake's uniform random rotation.
  const u1 = rand();
  const u2 = rand();
  const u3 = rand();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return {
    x: s1 * Math.sin(2 * Math.PI * u2),
    y: s1 * Math.cos(2 * Math.PI * u2),
    z: s2 * Math.sin(2 * Math.PI * u3),
    w: s2 * Math.cos(2 * Math.PI * u3),
  };
}

/** Deterministic PRNG so a failure is always reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('quantization', () => {
  it('round-trips positions within the documented precision', () => {
    const rand = mulberry32(1);
    const prec = positionPrecision(DEFAULT_BOUNDS);
    // ~1 mm at 64 m, per docs/gearbox/05-realtime.md §5.4.
    expect(prec.x).toBeLessThan(0.001);

    for (let i = 0; i < 2000; i++) {
      const pos = {
        x: DEFAULT_BOUNDS.min.x + rand() * (DEFAULT_BOUNDS.max.x - DEFAULT_BOUNDS.min.x),
        y: DEFAULT_BOUNDS.min.y + rand() * (DEFAULT_BOUNDS.max.y - DEFAULT_BOUNDS.min.y),
        z: DEFAULT_BOUNDS.min.z + rand() * (DEFAULT_BOUNDS.max.z - DEFAULT_BOUNDS.min.z),
      };
      const out = decode(
        encode('TransformUpdate', {
          objectId: 1,
          epoch: 1,
          position: pos,
          rotation: identity,
          flags: 0,
        }),
      );
      const got = out.body.position as { x: number; y: number; z: number };
      expect(Math.abs(got.x - pos.x)).toBeLessThanOrEqual(prec.x + 1e-9);
      expect(Math.abs(got.y - pos.y)).toBeLessThanOrEqual(prec.y + 1e-9);
      expect(Math.abs(got.z - pos.z)).toBeLessThanOrEqual(prec.z + 1e-9);
    }
  });

  it('clamps positions outside the session bounds instead of wrapping', () => {
    const out = decode(
      encode('TransformUpdate', {
        objectId: 1,
        epoch: 1,
        position: { x: 1e6, y: -1e6, z: 0 },
        rotation: identity,
        flags: 0,
      }),
    );
    const got = out.body.position as { x: number; y: number; z: number };
    expect(got.x).toBeCloseTo(DEFAULT_BOUNDS.max.x, 3);
    expect(got.y).toBeCloseTo(DEFAULT_BOUNDS.min.y, 3);
  });

  it('round-trips rotations to better than 0.5 degrees', () => {
    const rand = mulberry32(7);
    const limit = (0.5 * Math.PI) / 180;
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const q = randomUnitQuat(rand);
      const back = unpackQuat(packQuat(q));
      const err = quatAngleBetween(q, back);
      worst = Math.max(worst, err);
      expect(err).toBeLessThan(limit);
    }
    expect(worst).toBeGreaterThan(0); // sanity: quantization is actually lossy
  });

  it('treats q and -q as the same rotation', () => {
    const q: Quat = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 };
    const neg: Quat = { x: -0.5, y: -0.5, z: -0.5, w: -0.5 };
    expect(packQuat(q)).toBe(packQuat(neg));
  });

  it('emits identity for a degenerate zero quaternion rather than NaN', () => {
    const back = unpackQuat(packQuat({ x: 0, y: 0, z: 0, w: 0 }));
    expect(Number.isNaN(back.x)).toBe(false);
    // Identity is subject to the same 10-bit quantization as any other rotation, so
    // assert against the documented 0.5 degree budget rather than exactness.
    expect(quatAngleBetween(back, identity)).toBeLessThan((0.5 * Math.PI) / 180);
  });
});

describe('codec', () => {
  it('round-trips every message in the schema', () => {
    for (const def of MESSAGES) {
      const body: Record<string, unknown> = {};
      for (const f of def.fields) {
        switch (f.kind) {
          case 'vec3q':
            body[f.name] = { x: 1.5, y: -2.25, z: 3 };
            break;
          case 'quat32':
            body[f.name] = identity;
            break;
          case 'u8':
            body[f.name] = 200;
            break;
          case 'u16':
            body[f.name] = 40000;
            break;
          case 'u32':
            body[f.name] = 3_000_000_000;
            break;
          case 'i16':
            body[f.name] = -1234;
            break;
          case 'f32':
            body[f.name] = 0.5;
            break;
        }
      }
      const decoded = decode(encode(def.name, body as never));
      expect(decoded.name).toBe(def.name);
      for (const f of def.fields) {
        if (f.kind === 'vec3q') {
          const v = decoded.body[f.name] as { x: number };
          expect(v.x).toBeCloseTo(1.5, 3);
        } else if (f.kind === 'quat32') {
          expect(quatAngleBetween(decoded.body[f.name] as Quat, identity)).toBeLessThan(0.01);
        } else {
          expect(decoded.body[f.name]).toBe(body[f.name]);
        }
      }
    }
  });

  it('produces the documented header and payload sizes', () => {
    for (const def of MESSAGES) {
      const bytes = encode(def.name, buildSample(def.fields) as never);
      expect(bytes.byteLength).toBe(encodedSize(def));
      expect(bytes[0]).toBe(PROTOCOL_VERSION);
      expect(bytes[1]).toBe(def.id);
    }
  });

  it('keeps PoseUpdate inside the per-participant bandwidth budget', () => {
    // docs/gearbox/05-realtime.md §5.4 budgets ~46 bytes per participant per tick.
    const sizes = wireSizeTable();
    expect(sizes.PoseUpdate).toBeLessThanOrEqual(48);
    // 8 participants at 20 Hz must stay well under the 150 kbps state budget.
    const bitsPerSec = (sizes.PoseUpdate as number) * 8 * 20 * 8;
    expect(bitsPerSec).toBeLessThan(150_000);
  });

  it('rejects an unknown message name', () => {
    expect(() => encode('NoSuchMessage', {})).toThrowError(ProtocolError);
  });

  it('rejects a missing field rather than silently writing zero', () => {
    expect(() => encode('OwnershipGrant', { objectId: 1 })).toThrowError(/missing field/);
  });

  it('rejects a truncated packet', () => {
    const full = encode('ResyncRequest', { lastAppliedSeq: 42 });
    expect(() => decode(full.subarray(0, 2))).toThrowError(/shorter than header/);
    expect(() => decode(full.subarray(0, HEADER_SIZE + 1))).toThrowError(/truncated/);
  });

  it('rejects a mismatched protocol version', () => {
    const bytes = encode('ResyncRequest', { lastAppliedSeq: 1 });
    bytes[0] = PROTOCOL_VERSION + 1;
    expect(() => decode(bytes)).toThrowError(/version mismatch/i);
  });

  it('rejects an unknown message id', () => {
    const bytes = encode('ResyncRequest', { lastAppliedSeq: 1 });
    bytes[1] = 0xfe;
    expect(() => decode(bytes)).toThrowError(/Unknown message id/);
  });

  it('rejects a declared length that disagrees with the schema', () => {
    const bytes = encode('ResyncRequest', { lastAppliedSeq: 1 });
    new DataView(bytes.buffer).setUint16(2, 99, true);
    expect(() => decode(bytes)).toThrowError(/declared payload/);
  });

  it('never reuses a message id', () => {
    const ids = MESSAGES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('payloadSize agrees with the bytes actually written', () => {
    for (const def of MESSAGES) {
      const bytes = encode(def.name, buildSample(def.fields) as never);
      expect(bytes.byteLength - HEADER_SIZE).toBe(payloadSize(def));
    }
  });
});

function buildSample(fields: readonly { name: string; kind: string }[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    body[f.name] = f.kind === 'vec3q' ? { x: 0, y: 0, z: 0 } : f.kind === 'quat32' ? identity : 1;
  }
  return body;
}
