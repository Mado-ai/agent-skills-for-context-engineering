/**
 * VR interaction: locomotion, comfort, grabbing, haptics.
 *
 * A WebXR page with a camera and a ray is not yet virtual reality. The things that
 * make it VR are here:
 *
 *   - thumbstick locomotion, because nobody can physically walk an 8 m room
 *   - snap turn by default, because smooth turn is the single biggest cause of
 *     motion sickness (docs/gearbox/07-authz-security.md §7.6 makes comfort settings
 *     user-owned and unoverridable — this is the prototype of that)
 *   - a movement vignette, for the same reason
 *   - grab with the grip button, so you can pick a collected thing up and bring it
 *     to your face. That moment is the entire emotional argument for the room.
 *   - haptics, because feedback you feel is what makes a grab read as real
 *
 * Kept in its own module so main.ts stays about the scene rather than about input.
 */

import type { Group, Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector3,
} from 'three';

/** Anything in the room that can be pointed at and picked up. */
export interface Grabbable {
  readonly id: string;
  /** Moved when held; sprung back to `home` on release. */
  readonly pivot: Object3D;
  /** The mesh the ray actually tests against. */
  readonly mesh: Object3D;
  readonly home: Vector3;
}

export interface XRInteractionOptions {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  /** The XR rig. Locomotion moves this, never the camera. */
  rig: Group;
  grabbables: readonly Grabbable[];
  onSelect: (id: string | null) => void;
  onGrabChange: (id: string | null) => void;
  /** Veto grabbing (e.g. an item someone else is holding). Defaults to always-yes. */
  canGrab?: (id: string) => boolean;
  moveSpeed?: number;
  snapTurnDegrees?: number;
}

interface ControllerState {
  readonly index: number;
  readonly ray: Group;
  readonly grip: Group;
  readonly rayLine: Line;
  readonly cursor: Mesh;
  hovered: Grabbable | null;
  held: Grabbable | null;
  /** Debounce so one stick flick is one turn, not thirty. */
  turnLatched: boolean;
}

const UP = new Vector3(0, 1, 0);
const DEAD_ZONE = 0.18;
const SPRING_BACK_SECONDS = 0.45;

export class XRInteraction {
  private readonly opts: Required<XRInteractionOptions>;
  private readonly controllers: ControllerState[] = [];
  private readonly raycaster = new Raycaster();
  private readonly vignette: Mesh;
  private readonly meshes: Object3D[];

  /** Items animating back to their plinth after release. */
  private readonly returning = new Map<string, { from: Vector3; t: number }>();

  private moveIntensity = 0;

  constructor(options: XRInteractionOptions) {
    this.opts = {
      moveSpeed: 1.9,
      snapTurnDegrees: 30,
      canGrab: () => true,
      ...options,
    };
    this.meshes = options.grabbables.map((g) => g.mesh);

    for (let i = 0; i < 2; i++) {
      this.controllers.push(this.buildController(i));
    }

    this.vignette = this.buildVignette();
    this.opts.camera.add(this.vignette);
  }

  private buildController(index: number): ControllerState {
    const { renderer, rig } = this.opts;

    const ray = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);

    const rayGeo = new BufferGeometry();
    rayGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    const rayLine = new Line(
      rayGeo,
      new LineBasicMaterial({ color: new Color('#ffffff'), transparent: true, opacity: 0.65 }),
    );
    rayLine.scale.z = 4;
    ray.add(rayLine);

    // A small disc at the ray's end reads as a cursor; a bare line does not.
    const cursor = new Mesh(
      new RingGeometry(0.012, 0.022, 24),
      new MeshBasicMaterial({
        color: new Color('#3d9c50'),
        transparent: true,
        opacity: 0.9,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthTest: false,
      }),
    );
    cursor.visible = false;
    ray.add(cursor);

    // Minimal controller stand-in. A loaded controller model costs a GLTF fetch and
    // adds nothing here — what matters is knowing where your hand is.
    const wand = new Mesh(
      new ConeGeometry(0.018, 0.09, 12),
      new MeshBasicMaterial({ color: new Color('#a9a294') }),
    );
    wand.rotation.x = -Math.PI / 2;
    grip.add(wand);

    rig.add(ray);
    rig.add(grip);

    const state: ControllerState = {
      index,
      ray,
      grip,
      rayLine,
      cursor,
      hovered: null,
      held: null,
      turnLatched: false,
    };

    // Trigger inspects. Grip picks up. Two buttons, two verbs — the mapping people
    // already expect from every other VR app.
    ray.addEventListener('selectstart', () => {
      const hit = state.hovered;
      this.opts.onSelect(hit ? hit.id : null);
      if (hit) this.pulse(index, 0.35, 30);
    });

    ray.addEventListener('squeezestart', () => this.grab(state));
    ray.addEventListener('squeezeend', () => this.release(state));

    return state;
  }

  /** Radial darkening during movement. Cheap, and it genuinely helps. */
  private buildVignette(): Mesh {
    const mesh = new Mesh(
      new RingGeometry(0.34, 1.6, 48),
      new MeshBasicMaterial({
        color: new Color('#161511'),
        transparent: true,
        opacity: 0,
        depthTest: false,
        side: DoubleSide,
      }),
    );
    mesh.position.z = -0.6;
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    return mesh;
  }

  private grab(state: ControllerState): void {
    const target = state.hovered;
    if (!target || target.pivot.userData.heldBy !== undefined) return;
    if (!this.opts.canGrab(target.id)) {
      // A short flat buzz reads as "no" without any UI.
      this.pulse(state.index, 0.15, 60);
      return;
    }

    // Steal from the other hand rather than tugging in two directions at once.
    for (const other of this.controllers) {
      if (other !== state && other.held?.id === target.id) other.held = null;
    }

    state.held = target;
    target.pivot.userData.heldBy = state.index;
    this.returning.delete(target.id);
    this.opts.onGrabChange(target.id);
    this.pulse(state.index, 0.7, 60);
  }

  private release(state: ControllerState): void {
    const held = state.held;
    if (!held) return;

    state.held = null;
    delete held.pivot.userData.heldBy;
    this.returning.set(held.id, { from: held.pivot.position.clone(), t: 0 });
    this.opts.onGrabChange(null);
    this.pulse(state.index, 0.3, 40);
  }

  private pulse(index: number, intensity: number, ms: number): void {
    const session = this.opts.renderer.xr.getSession();
    const source = session?.inputSources?.[index];
    const actuator = source?.gamepad?.hapticActuators?.[0];
    // Not every runtime exposes haptics; absence must never throw.
    void actuator?.pulse?.(intensity, ms);
  }

  /** True while any controller is holding something. */
  get heldItem(): Grabbable | null {
    return this.controllers.find((c) => c.held)?.held ?? null;
  }

  /** Server refused the grab: undo the optimistic hold as if the grip opened. */
  forceRelease(id: string): void {
    const holder = this.controllers.find((c) => c.held?.id === id);
    if (holder) this.release(holder);
  }

  /** Animate an item from wherever it is back to its home (remote release). */
  springHome(id: string): void {
    const target = this.opts.grabbables.find((g) => g.id === id);
    if (!target || target.pivot.userData.heldBy !== undefined) return;
    this.returning.set(id, { from: target.pivot.position.clone(), t: 0 });
  }

  update(dt: number): void {
    const presenting = this.opts.renderer.xr.isPresenting;

    for (const state of this.controllers) {
      state.ray.visible = presenting;
      state.grip.visible = presenting;
      if (presenting) this.updateHover(state);
      if (state.held) this.updateHeld(state);
    }

    if (presenting) this.updateLocomotion(dt);
    this.updateReturning(dt);
    this.updateVignette(dt);
  }

  private updateHover(state: ControllerState): void {
    if (state.held) {
      state.cursor.visible = false;
      state.rayLine.scale.z = 0.4;
      return;
    }

    const origin = new Vector3();
    const quat = new Quaternion();
    state.ray.getWorldPosition(origin);
    state.ray.getWorldQuaternion(quat);
    const direction = new Vector3(0, 0, -1).applyQuaternion(quat).normalize();

    this.raycaster.set(origin, direction);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];

    if (hit) {
      const found = this.opts.grabbables.find((g) => g.mesh === hit.object) ?? null;
      if (found !== state.hovered && found) this.pulse(state.index, 0.12, 12);
      state.hovered = found;
      state.rayLine.scale.z = hit.distance;
      state.cursor.position.set(0, 0, -hit.distance);
      state.cursor.visible = true;
    } else {
      state.hovered = null;
      state.rayLine.scale.z = 4;
      state.cursor.visible = false;
    }
  }

  private updateHeld(state: ControllerState): void {
    const held = state.held;
    if (!held) return;
    // Offset forward from the grip so the item sits in front of the hand rather
    // than inside it.
    const pos = new Vector3(0, 0, -0.09);
    state.grip.localToWorld(pos);
    held.pivot.position.copy(pos);
  }

  private updateReturning(dt: number): void {
    for (const [id, anim] of this.returning) {
      const target = this.opts.grabbables.find((g) => g.id === id);
      if (!target) {
        this.returning.delete(id);
        continue;
      }
      anim.t = Math.min(1, anim.t + dt / SPRING_BACK_SECONDS);
      // Ease-out so it settles rather than snapping.
      const e = 1 - Math.pow(1 - anim.t, 3);
      target.pivot.position.lerpVectors(anim.from, target.home, e);
      if (anim.t >= 1) this.returning.delete(id);
    }
  }

  private updateLocomotion(dt: number): void {
    const session = this.opts.renderer.xr.getSession();
    if (!session) return;

    const { camera, rig, moveSpeed, snapTurnDegrees } = this.opts;
    let moving = 0;

    for (const source of session.inputSources) {
      const axes = source.gamepad?.axes;
      if (!axes || axes.length === 0) continue;

      // Touch-style controllers report the thumbstick on axes 2/3; older devices
      // report a touchpad on 0/1. Accept either.
      const x = (axes.length >= 4 ? axes[2] : axes[0]) ?? 0;
      const y = (axes.length >= 4 ? axes[3] : axes[1]) ?? 0;

      const state = this.controllers[source.handedness === 'right' ? 1 : 0];

      if (source.handedness === 'right') {
        // Snap turn. Latched so a held stick turns once, not continuously.
        if (state && Math.abs(x) > 0.7) {
          if (!state.turnLatched) {
            this.snapTurn(((x > 0 ? -1 : 1) * snapTurnDegrees * Math.PI) / 180);
            state.turnLatched = true;
            this.pulse(state.index, 0.25, 25);
          }
        } else if (state) {
          state.turnLatched = false;
        }
        continue;
      }

      // Left stick: head-relative movement on the horizontal plane.
      const mag = Math.hypot(x, y);
      if (mag < DEAD_ZONE) continue;
      moving = Math.max(moving, Math.min(1, (mag - DEAD_ZONE) / (1 - DEAD_ZONE)));

      const quat = new Quaternion();
      camera.getWorldQuaternion(quat);
      const forward = new Vector3(0, 0, -1).applyQuaternion(quat).setY(0).normalize();
      const right = new Vector3(1, 0, 0).applyQuaternion(quat).setY(0).normalize();

      rig.position.addScaledVector(forward, -y * moveSpeed * dt);
      rig.position.addScaledVector(right, x * moveSpeed * dt);
    }

    this.moveIntensity += (moving - this.moveIntensity) * Math.min(dt * 8, 1);
  }

  /** Rotates about the head, not the rig origin — otherwise you orbit the room. */
  private snapTurn(angle: number): void {
    const { camera, rig } = this.opts;
    const head = new Vector3();
    camera.getWorldPosition(head);

    rig.position.sub(head);
    rig.position.applyAxisAngle(UP, angle);
    rig.position.add(head);
    rig.rotation.y += angle;
  }

  private updateVignette(dt: number): void {
    const material = this.vignette.material as MeshBasicMaterial;
    const target = this.opts.renderer.xr.isPresenting ? this.moveIntensity * 0.72 : 0;
    material.opacity += (target - material.opacity) * Math.min(dt * 6, 1);
    this.vignette.visible = material.opacity > 0.01;
  }

  /** Keeps the rig inside the room. Walls you can walk through read as a bug. */
  clampToRoom(halfWidth: number, halfDepth: number, margin = 0.55): void {
    const { rig } = this.opts;
    rig.position.x = Math.max(-halfWidth + margin, Math.min(halfWidth - margin, rig.position.x));
    rig.position.z = Math.max(-halfDepth + margin, Math.min(halfDepth - margin, rig.position.z));
  }
}
