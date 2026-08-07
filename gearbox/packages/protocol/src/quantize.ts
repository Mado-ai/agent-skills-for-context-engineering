/**
 * Quantization for the realtime wire format (docs/gearbox/05-realtime.md §5.4).
 *
 * Positions are quantized into the session's declared bounds; rotations use a
 * smallest-three quaternion. Both are lossy by design — the loss is far below
 * perceptual threshold and buys roughly a 3x reduction in per-tick bandwidth.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Axis-aligned session bounds. Position precision is (max-min)/65535 per axis. */
export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Default bounds: a 64 m cube centred on the anchor → ~1 mm precision. */
export const DEFAULT_BOUNDS: Bounds = Object.freeze({
  min: { x: -32, y: -8, z: -32 },
  max: { x: 32, y: 24, z: 32 },
});

const U16_MAX = 65535;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function quantizeAxis(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return 0;
  const t = clamp((value - min) / span, 0, 1);
  return Math.round(t * U16_MAX);
}

export function dequantizeAxis(q: number, min: number, max: number): number {
  return min + (q / U16_MAX) * (max - min);
}

/** Worst-case position error introduced by quantization, per axis, in metres. */
export function positionPrecision(bounds: Bounds): Vec3 {
  return {
    x: (bounds.max.x - bounds.min.x) / U16_MAX / 2,
    y: (bounds.max.y - bounds.min.y) / U16_MAX / 2,
    z: (bounds.max.z - bounds.min.z) / U16_MAX / 2,
  };
}

const SQRT2_INV = Math.SQRT1_2; // 1/sqrt(2) — bound on the three smallest components
const TEN_BITS = 1023;

/**
 * Smallest-three quaternion packing into 32 bits.
 *
 * A unit quaternion has three degrees of freedom, so the largest component can be
 * reconstructed from the other three. We store a 2-bit index plus 3x10 bits.
 * Angular error is on the order of 0.1 degrees.
 */
export function packQuat(q: Quat): number {
  let { x, y, z, w } = q;

  const len = Math.hypot(x, y, z, w);
  if (len === 0) {
    // Degenerate input; emit identity rather than NaN.
    x = 0;
    y = 0;
    z = 0;
    w = 1;
  } else {
    x /= len;
    y /= len;
    z /= len;
    w /= len;
  }

  const comps = [x, y, z, w];
  let maxIdx = 0;
  let maxAbs = Math.abs(comps[0] as number);
  for (let i = 1; i < 4; i++) {
    const a = Math.abs(comps[i] as number);
    if (a > maxAbs) {
      maxAbs = a;
      maxIdx = i;
    }
  }

  // q and -q represent the same rotation; normalise the sign of the dropped component
  // so the decoder can always reconstruct it as positive.
  const sign = (comps[maxIdx] as number) < 0 ? -1 : 1;

  const rest: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i === maxIdx) continue;
    rest.push((comps[i] as number) * sign);
  }

  const enc = rest.map((v) => {
    const t = clamp((v + SQRT2_INV) / (2 * SQRT2_INV), 0, 1);
    return Math.round(t * TEN_BITS);
  });

  return (
    ((maxIdx & 0x3) * 0x40000000 + // << 30 without tripping int32 sign
      ((enc[0] as number) << 20) +
      ((enc[1] as number) << 10) +
      (enc[2] as number)) >>>
    0
  );
}

export function unpackQuat(packed: number): Quat {
  const p = packed >>> 0;
  const maxIdx = Math.floor(p / 0x40000000) & 0x3;
  const a = (p >>> 20) & TEN_BITS;
  const b = (p >>> 10) & TEN_BITS;
  const c = p & TEN_BITS;

  const dec = [a, b, c].map((v) => (v / TEN_BITS) * (2 * SQRT2_INV) - SQRT2_INV);

  const sumSq = dec.reduce((s, v) => s + v * v, 0);
  const largest = Math.sqrt(Math.max(0, 1 - sumSq));

  const out = [0, 0, 0, 0];
  out[maxIdx] = largest;
  let j = 0;
  for (let i = 0; i < 4; i++) {
    if (i === maxIdx) continue;
    out[i] = dec[j++] as number;
  }

  return { x: out[0] as number, y: out[1] as number, z: out[2] as number, w: out[3] as number };
}

/** Angular difference between two unit quaternions, in radians. */
export function quatAngleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(clamp(dot, -1, 1));
}
