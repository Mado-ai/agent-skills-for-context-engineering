import { describe, expect, it } from 'vitest';
import { INTERPOLATION_DELAY_MS, InterpolationBuffer, type AvatarPose } from './interpolation.js';

function poseAt(x: number): AvatarPose {
  const p = { position: { x, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  return { head: p, leftHand: p, rightHand: p, handsValid: true, voiceAmplitude: 0 };
}

describe('InterpolationBuffer', () => {
  it('returns null before any sample and the first sample when behind the buffer', () => {
    const buf = new InterpolationBuffer();
    expect(buf.sample(1000)).toBeNull();
    buf.push(1000, poseAt(1));
    expect(buf.sample(1000)!.head.position.x).toBe(1);
  });

  it('interpolates linearly between two samples at the render delay', () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, poseAt(0));
    buf.push(1050, poseAt(1));
    // Render time targets t=1025 → halfway.
    const out = buf.sample(1025 + INTERPOLATION_DELAY_MS)!;
    expect(out.head.position.x).toBeCloseTo(0.5, 5);
  });

  it('holds the last pose instead of extrapolating when the buffer runs dry', () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, poseAt(0));
    buf.push(1050, poseAt(1));
    const out = buf.sample(1050 + INTERPOLATION_DELAY_MS + 5000)!;
    expect(out.head.position.x).toBe(1); // held, not extrapolated past 1
  });

  it('accepts out-of-order samples (unreliable transport reorders)', () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, poseAt(0));
    buf.push(1100, poseAt(2));
    buf.push(1050, poseAt(1)); // arrives late
    const out = buf.sample(1075 + INTERPOLATION_DELAY_MS)!;
    expect(out.head.position.x).toBeCloseTo(1.5, 5);
  });

  it('interpolates rotation via the shorter arc (hemisphere correction)', () => {
    const buf = new InterpolationBuffer();
    const a: AvatarPose = poseAt(0);
    const b: AvatarPose = poseAt(0);
    // q and -q are the same rotation; naive lerp through zero would collapse.
    b.head = { position: b.head.position, rotation: { x: 0, y: 0, z: 0, w: -1 } };
    buf.push(1000, a);
    buf.push(1100, b);
    const out = buf.sample(1050 + INTERPOLATION_DELAY_MS)!;
    const len = Math.hypot(
      out.head.rotation.x,
      out.head.rotation.y,
      out.head.rotation.z,
      out.head.rotation.w,
    );
    expect(len).toBeCloseTo(1, 5);
    expect(Math.abs(out.head.rotation.w)).toBeCloseTo(1, 5);
  });
});
