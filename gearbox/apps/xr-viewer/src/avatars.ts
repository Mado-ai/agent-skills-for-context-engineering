/**
 * Remote avatar rendering: body, head, hands, nameplate — driven by interpolated
 * poses from the session. Presence is half the product; these are the people.
 */

import type { Quaternion, Vector3 } from 'three';
import {
  CapsuleGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Scene,
} from 'three';
import type { AvatarPose } from '@gearbox/networking-sdk';
import { presenceTexture } from './labels.js';

/** Brand accent per participant, cycled by index. */
const AVATAR_COLORS = ['#8fbe97', '#d9b27c', '#93b7cc', '#c5a8c9'];

class RemoteAvatar {
  readonly group = new Group();
  private readonly body: Mesh;
  private readonly head: Mesh;
  private readonly leftHand: Mesh;
  private readonly rightHand: Mesh;
  private readonly plate: Mesh;

  constructor(handle: string, colorIndex: number) {
    const color = new Color(AVATAR_COLORS[colorIndex % AVATAR_COLORS.length]);

    this.body = new Mesh(
      new CapsuleGeometry(0.17, 0.5, 6, 16),
      new MeshStandardMaterial({ color, roughness: 0.6 }),
    );
    this.body.castShadow = true;

    this.head = new Mesh(
      new IcosahedronGeometry(0.13, 1),
      new MeshStandardMaterial({ color: new Color('#dcd4c0'), roughness: 0.55 }),
    );
    this.head.castShadow = true;

    const handGeo = new SphereGeometry(0.045, 12, 10);
    const handMat = new MeshStandardMaterial({ color, roughness: 0.5 });
    this.leftHand = new Mesh(handGeo, handMat);
    this.rightHand = new Mesh(handGeo, handMat);

    this.plate = new Mesh(
      new PlaneGeometry(0.56, 0.153),
      new MeshBasicMaterial({ map: presenceTexture(handle, 'in your room'), transparent: true }),
    );

    this.group.add(this.body, this.head, this.leftHand, this.rightHand, this.plate);
    this.group.visible = false; // until the first pose arrives
  }

  apply(pose: AvatarPose, cameraWorld: Vector3): void {
    this.group.visible = true;

    const h = pose.head;
    this.head.position.set(h.position.x, h.position.y, h.position.z);
    this.head.quaternion.set(h.rotation.x, h.rotation.y, h.rotation.z, h.rotation.w);

    // The body stands under the head and turns only about Y — full head rotation on a
    // capsule reads as the whole person tumbling.
    this.body.position.set(h.position.x, h.position.y - 0.55, h.position.z);
    this.body.rotation.y = yawOf(this.head.quaternion);

    this.leftHand.visible = pose.handsValid;
    this.rightHand.visible = pose.handsValid;
    if (pose.handsValid) {
      this.leftHand.position.set(
        pose.leftHand.position.x,
        pose.leftHand.position.y,
        pose.leftHand.position.z,
      );
      this.rightHand.position.set(
        pose.rightHand.position.x,
        pose.rightHand.position.y,
        pose.rightHand.position.z,
      );
    }

    this.plate.position.set(h.position.x, h.position.y + 0.32, h.position.z);
    this.plate.lookAt(cameraWorld);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

function yawOf(q: Quaternion): number {
  // Yaw about Y from a quaternion, ignoring pitch/roll.
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export class RemoteAvatars {
  private readonly avatars = new Map<number, RemoteAvatar>();
  private colorCursor = 0;

  constructor(private readonly scene: Scene) {}

  add(index: number, handle: string): void {
    if (this.avatars.has(index)) return;
    const avatar = new RemoteAvatar(handle, this.colorCursor++);
    this.avatars.set(index, avatar);
    this.scene.add(avatar.group);
  }

  remove(index: number): void {
    this.avatars.get(index)?.dispose();
    this.avatars.delete(index);
  }

  update(sample: (index: number) => AvatarPose | null, cameraWorld: Vector3): void {
    for (const [index, avatar] of this.avatars) {
      const pose = sample(index);
      if (pose) avatar.apply(pose, cameraWorld);
    }
  }
}
