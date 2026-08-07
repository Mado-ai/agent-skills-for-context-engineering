/**
 * Remote-avatar interpolation (docs/gearbox/05-realtime.md §5.3).
 *
 * Remote avatars are rendered ~100 ms in the past and interpolated between real
 * samples — smoothing, not prediction. Extrapolating human limb motion produces the
 * rubber-band artifact that makes social VR feel wrong, so we never guess forward;
 * when the buffer runs dry we hold the last pose.
 */

import type { Quat, Vec3 } from '@gearbox/protocol';

export interface Pose {
  position: Vec3;
  rotation: Quat;
}

export interface AvatarPose {
  head: Pose;
  leftHand: Pose;
  rightHand: Pose;
  handsValid: boolean;
  voiceAmplitude: number;
}

interface Sample {
  at: number;
  pose: AvatarPose;
}

export const INTERPOLATION_DELAY_MS = 100;
const MAX_BUFFER_MS = 1000;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/**
 * Normalized-lerp between quaternions with hemisphere correction. nlerp is not
 * constant-velocity like slerp, but at 20 Hz sample spacing the difference is far
 * below perceptual threshold and it is branch-free and cheap.
 */
function nlerpQuat(a: Quat, b: Quat, t: number): Quat {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const sign = dot < 0 ? -1 : 1;
  const x = lerp(a.x, b.x * sign, t);
  const y = lerp(a.y, b.y * sign, t);
  const z = lerp(a.z, b.z * sign, t);
  const w = lerp(a.w, b.w * sign, t);
  const len = Math.hypot(x, y, z, w) || 1;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    position: lerpVec3(a.position, b.position, t),
    rotation: nlerpQuat(a.rotation, b.rotation, t),
  };
}

export class InterpolationBuffer {
  private readonly samples: Sample[] = [];

  push(at: number, pose: AvatarPose): void {
    // Out-of-order arrivals (unreliable transport) are inserted, not appended.
    let i = this.samples.length;
    while (i > 0 && (this.samples[i - 1] as Sample).at > at) i--;
    this.samples.splice(i, 0, { at, pose });

    const cutoff = at - MAX_BUFFER_MS;
    while (this.samples.length > 2 && (this.samples[0] as Sample).at < cutoff) {
      this.samples.shift();
    }
  }

  /** Sample at `now - INTERPOLATION_DELAY_MS`. Null until the first sample arrives. */
  sample(now: number): AvatarPose | null {
    if (this.samples.length === 0) return null;
    const target = now - INTERPOLATION_DELAY_MS;

    const first = this.samples[0] as Sample;
    if (target <= first.at) return first.pose;

    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i] as Sample;
      const b = this.samples[i + 1] as Sample;
      if (target >= a.at && target <= b.at) {
        const span = b.at - a.at;
        const t = span > 0 ? (target - a.at) / span : 1;
        return {
          head: lerpPose(a.pose.head, b.pose.head, t),
          leftHand: lerpPose(a.pose.leftHand, b.pose.leftHand, t),
          rightHand: lerpPose(a.pose.rightHand, b.pose.rightHand, t),
          handsValid: b.pose.handsValid,
          voiceAmplitude: lerp(a.pose.voiceAmplitude, b.pose.voiceAmplitude, t),
        };
      }
    }

    // Buffer ran dry: hold the last pose. Never extrapolate.
    return (this.samples[this.samples.length - 1] as Sample).pose;
  }
}
