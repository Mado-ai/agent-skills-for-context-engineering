/**
 * GearBox — Room View (WebXR)
 *
 * A design prototype of the payoff the whole MVP hinges on: the persistent personal
 * room where things you collected at real places in the world live as physical objects
 * (docs/gearbox/11-geospatial-mvp.md §11.4, step D→E).
 *
 * This is a *view*, not the client. There is no networking, no auth, no anchors — the
 * point is to make the bridge tangible enough to judge before sprint 6 builds it.
 *
 * Styled to the GearBox brand: a warm, daylit home — cream plaster, oak floor, cove
 * light, white rounded cards — anchored by the green hub cube from the brand's home
 * screen. The collected items glow as accents inside that warmth.
 */

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRInteraction, type Grabbable } from './xr-interaction.js';
import { COLLECTION, DASHBOARD, type CollectedItem } from './collection.js';
import {
  dashboardTexture,
  nameplateTexture,
  presenceTexture,
  provenanceTexture,
  PALETTE,
} from './labels.js';
import { windowTexture, woodFloorTexture } from './textures.js';

const ROOM = { width: 8, depth: 8, height: 3.2 };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── renderer ────────────────────────────────────────────────────────────────────
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.xr.enabled = true;
document.getElementById('stage')?.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(PALETTE.cream);

const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 60);
camera.position.set(0, 1.55, 2.45);

/** The XR rig. In VR the headset drives the camera inside this group; we move the rig. */
const rig = new Group();
rig.add(camera);
scene.add(rig);

// ── room shell ──────────────────────────────────────────────────────────────────
const shell = new Group();
scene.add(shell);

const plasterMat = new MeshStandardMaterial({
  color: new Color('#e9e3d6'),
  roughness: 0.94,
  metalness: 0,
  side: BackSide,
});
const room = new Mesh(new BoxGeometry(ROOM.width, ROOM.height, ROOM.depth), plasterMat);
room.position.y = ROOM.height / 2;
room.receiveShadow = true;
shell.add(room);

const floor = new Mesh(
  new PlaneGeometry(ROOM.width, ROOM.depth),
  new MeshStandardMaterial({ map: woodFloorTexture(), roughness: 0.72, metalness: 0.02 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
shell.add(floor);

/**
 * Guardian boundary. Present because the safety layer is an architectural invariant,
 * not a feature (docs/gearbox/07-authz-security.md §7.6) — a room view that quietly
 * omitted it would be misrepresenting the product.
 */
function buildBoundary(): Line {
  const inset = 0.55;
  const hw = ROOM.width / 2 - inset;
  const hd = ROOM.depth / 2 - inset;
  const pts = [
    [-hw, 0.012, -hd],
    [hw, 0.012, -hd],
    [hw, 0.012, hd],
    [-hw, 0.012, hd],
    [-hw, 0.012, -hd],
  ];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3));
  return new Line(
    geo,
    new LineBasicMaterial({
      color: new Color(PALETTE.greenBright),
      transparent: true,
      opacity: 0.3,
    }),
  );
}
shell.add(buildBoundary());

// Arched windows on the west wall. Warm daylight is most of what makes the room read
// as a home rather than a gallery.
const windowMat = new MeshBasicMaterial({ map: windowTexture(), toneMapped: false });
for (const z of [-1.35, 1.05]) {
  const win = new Mesh(new PlaneGeometry(1.15, 1.72), windowMat);
  win.position.set(-ROOM.width / 2 + 0.03, 1.78, z);
  win.rotation.y = Math.PI / 2;
  shell.add(win);
}

// Warm LED cove where the walls meet the ceiling — straight out of the brand's home.
const coveMat = new MeshBasicMaterial({ color: new Color('#ffdca6'), toneMapped: false });
const coveY = ROOM.height - 0.09;
const coveNorth = new Mesh(new BoxGeometry(ROOM.width - 0.5, 0.035, 0.05), coveMat);
coveNorth.position.set(0, coveY, -ROOM.depth / 2 + 0.09);
const coveSouth = coveNorth.clone();
coveSouth.position.z = ROOM.depth / 2 - 0.09;
const coveWest = new Mesh(new BoxGeometry(0.05, 0.035, ROOM.depth - 0.5), coveMat);
coveWest.position.set(-ROOM.width / 2 + 0.09, coveY, 0);
const coveEast = coveWest.clone();
coveEast.position.x = ROOM.width / 2 - 0.09;
shell.add(coveNorth, coveSouth, coveWest, coveEast);

// ── the hub ─────────────────────────────────────────────────────────────────────
// The centrepiece from the brand's home screen: a low platform, a warm floor ring,
// and the green holographic GearBox cube. It anchors the room the way the logo
// anchors the UI.
let hubCube!: Mesh;
let hubEdges!: LineSegments;
{
  const hub = new Group();
  hub.position.set(0, 0, -0.3);

  const base = new Mesh(
    new CylinderGeometry(0.58, 0.62, 0.1, 48),
    new MeshStandardMaterial({ color: new Color('#efe9db'), roughness: 0.8 }),
  );
  base.position.y = 0.05;
  base.receiveShadow = true;

  const warmRing = new Mesh(
    new RingGeometry(0.63, 0.71, 64),
    new MeshBasicMaterial({
      color: new Color('#ffdca6'),
      transparent: true,
      opacity: 0.85,
      side: DoubleSide,
      toneMapped: false,
    }),
  );
  warmRing.rotation.x = -Math.PI / 2;
  warmRing.position.y = 0.006;

  const greenGlow = new Mesh(
    new RingGeometry(0.28, 0.4, 48),
    new MeshBasicMaterial({
      color: new Color(PALETTE.greenBright),
      transparent: true,
      opacity: 0.45,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  greenGlow.rotation.x = -Math.PI / 2;
  greenGlow.position.y = 0.106;

  hubCube = new Mesh(
    new BoxGeometry(0.17, 0.17, 0.17),
    new MeshStandardMaterial({
      color: new Color(PALETTE.greenBright),
      emissive: new Color(PALETTE.greenBright),
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.82,
      roughness: 0.3,
      metalness: 0.1,
    }),
  );
  hubCube.position.y = 0.62;

  hubEdges = new LineSegments(
    new EdgesGeometry(new BoxGeometry(0.23, 0.23, 0.23)),
    new LineBasicMaterial({ color: new Color('#bff0c8'), transparent: true, opacity: 0.9 }),
  );
  hubEdges.position.y = 0.62;

  const hubLight = new PointLight(new Color(PALETTE.greenBright), 1.1, 3.5, 2);
  hubLight.position.y = 0.7;

  // Soft projection beam from the platform up to the cube — it is what makes the
  // cube read as a hologram rising from the hub rather than a box in mid-air.
  const beam = new Mesh(
    new CylinderGeometry(0.09, 0.3, 0.52, 32, 1, true),
    new MeshBasicMaterial({
      color: new Color(PALETTE.greenBright),
      transparent: true,
      opacity: 0.14,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.y = 0.36;

  hub.add(base, warmRing, greenGlow, beam, hubCube, hubEdges, hubLight);
  scene.add(hub);
}

// ── lighting ────────────────────────────────────────────────────────────────────
// Warm daylight through the windows plus a soft sky/ground wash. The items and the
// hub glow as accents inside that warmth, not as the only light in a dark room.
scene.add(new HemisphereLight(new Color('#fff3e0'), new Color('#9a8a72'), 0.8));

const sun = new DirectionalLight(new Color('#ffe9c2'), 1.6);
sun.position.set(-4.2, 3.1, 0.7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -3;
scene.add(sun);
scene.add(sun.target);
sun.target.position.set(1.6, 0.4, -1.2);

// ── collected items ─────────────────────────────────────────────────────────────
function formGeometry(form: CollectedItem['form']): BufferGeometry {
  switch (form) {
    case 'lantern':
      return new OctahedronGeometry(0.13, 0);
    case 'echo':
      return new TorusGeometry(0.12, 0.035, 16, 48);
    case 'compass':
      return new TorusKnotGeometry(0.1, 0.028, 90, 14);
    case 'charm':
      return new IcosahedronGeometry(0.12, 0);
    case 'prism':
      return new DodecahedronGeometry(0.12, 0);
  }
}

interface PlacedItem {
  readonly item: CollectedItem;
  readonly pivot: Group;
  readonly mesh: Mesh;
  readonly halo: Mesh;
  readonly baseY: number;
  readonly phase: number;
}

const placed: PlacedItem[] = [];
const itemsGroup = new Group();
scene.add(itemsGroup);

const plinthMat = new MeshStandardMaterial({
  color: new Color('#f2eee2'),
  roughness: 0.78,
  metalness: 0.04,
});

// Arranged along a shallow arc so nothing occludes anything else from the entry point.
COLLECTION.forEach((item, i) => {
  const t = (i / (COLLECTION.length - 1)) * 2 - 1; // -1 … 1
  const x = t * 2.25;
  const z = -1.75 - Math.abs(t) * 0.5;

  const plinth = new Mesh(new CylinderGeometry(0.17, 0.2, 0.92, 24), plinthMat);
  plinth.position.set(x, 0.46, z);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  itemsGroup.add(plinth);

  const pivot = new Group();
  const baseY = 1.26;
  pivot.position.set(x, baseY, z);
  itemsGroup.add(pivot);

  const colour = new Color(item.light);
  const mesh = new Mesh(
    formGeometry(item.form),
    new MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: 1.5,
      roughness: 0.28,
      metalness: 0.5,
    }),
  );
  mesh.castShadow = true;
  mesh.userData.itemId = item.id;
  pivot.add(mesh);

  // Soft halo so each item reads as a light source, not a lit object.
  const halo = new Mesh(
    new RingGeometry(0.16, 0.27, 40),
    new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.16,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  pivot.add(halo);

  const light = new PointLight(colour, 1.1, 4, 2);
  light.castShadow = i < 3; // shadow-casting lights are the expensive part; cap them
  if (light.shadow) light.shadow.mapSize.set(512, 512);
  pivot.add(light);

  const plate = new Mesh(
    new PlaneGeometry(0.74, 0.23),
    new MeshBasicMaterial({
      map: nameplateTexture(item.name, item.provenance.place),
      transparent: true,
    }),
  );
  plate.position.set(x, 0.8, z + 0.22);
  itemsGroup.add(plate);

  placed.push({ item, pivot, mesh, halo, baseY, phase: i * 1.27 });
});

// ── wall dashboard ──────────────────────────────────────────────────────────────
const dashboard = new Mesh(
  new PlaneGeometry(1.68, 1.05),
  new MeshBasicMaterial({ map: dashboardTexture(DASHBOARD), transparent: true }),
);
dashboard.position.set(-2.5, 2.55, -ROOM.depth / 2 + 0.06);
scene.add(dashboard);
scene.add(pinLight(new Vector3(-2.5, 2.55, -3.2), '#ffe4b8', 0.6));

// ── portal back to the map ──────────────────────────────────────────────────────
// The loop closes here: the room is where you keep things, the map is where you go.
const portal = new Group();
portal.position.set(2.55, 2.2, -ROOM.depth / 2 + 0.07);
{
  const disc = new Mesh(
    new RingGeometry(0.3, 0.36, 64),
    new MeshBasicMaterial({
      color: new Color(PALETTE.greenBright),
      transparent: true,
      opacity: 0.85,
      side: DoubleSide,
    }),
  );
  const fill = new Mesh(
    new PlaneGeometry(0.62, 0.62),
    new MeshBasicMaterial({
      color: new Color(PALETTE.greenTint),
      transparent: true,
      opacity: 0.8,
      side: DoubleSide,
    }),
  );
  fill.position.z = -0.01;

  // A bare ring reads as decoration; the label is what makes it a way out.
  const label = new Mesh(
    new PlaneGeometry(0.86, 0.27),
    new MeshBasicMaterial({
      map: nameplateTexture('Back to the map', 'places nearby'),
      transparent: true,
    }),
  );
  label.position.set(0, -0.56, 0);

  portal.add(fill, disc, label);
}
scene.add(portal);
scene.add(pinLight(new Vector3(2.55, 2.2, -3.2), '#ffe4b8', 0.6));

// ── remote participant ──────────────────────────────────────────────────────────
// Presence is half the product; an empty room would sell it short.
const friend = new Group();
friend.position.set(-1.55, 0, -3.05);
{
  const body = new Mesh(
    new CapsuleGeometry(0.17, 0.5, 6, 16),
    new MeshStandardMaterial({
      color: new Color('#8fbe97'),
      roughness: 0.6,
      emissive: new Color(PALETTE.greenBright),
      emissiveIntensity: 0.06,
    }),
  );
  body.position.y = 1.02;
  body.castShadow = true;

  const head = new Mesh(
    new IcosahedronGeometry(0.13, 1),
    new MeshStandardMaterial({ color: new Color('#dcd4c0'), roughness: 0.55 }),
  );
  head.position.y = 1.48;
  head.castShadow = true;

  const plate = new Mesh(
    new PlaneGeometry(0.56, 0.153),
    new MeshBasicMaterial({ map: presenceTexture('@sam', 'in your room'), transparent: true }),
  );
  plate.position.y = 1.78;

  friend.add(body, head, plate);
  friend.userData.plate = plate;
}
scene.add(friend);

// ── provenance card ─────────────────────────────────────────────────────────────
const card = new Mesh(
  new PlaneGeometry(1.34, 0.923),
  new MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false }),
);
card.renderOrder = 10;
card.visible = false;
scene.add(card);

let selected: PlacedItem | null = null;
let cardOpacity = 0;

function select(next: PlacedItem | null): void {
  if (next === selected) return;
  selected = next;

  if (!next) {
    setStatus('Nothing selected');
    return;
  }

  const mat = card.material as MeshBasicMaterial;
  mat.map?.dispose();
  mat.map = provenanceTexture({
    name: next.item.name,
    place: next.item.provenance.place,
    area: next.item.provenance.area,
    lat: next.item.provenance.lat,
    lon: next.item.provenance.lon,
    h3r9: next.item.provenance.h3r9,
    collectedAt: next.item.provenance.collectedAt,
    withUsers: next.item.provenance.withUsers,
  });
  mat.needsUpdate = true;
  card.visible = true;

  const p = next.pivot.position;
  // Clamped so a left-hand selection never parks the card over the wall panel.
  const cardX = Math.max(-0.5, Math.min(1.2, p.x * 0.42));
  card.position.set(cardX, p.y + 0.28, p.z + 1.15);

  const withWhom =
    next.item.provenance.withUsers.length > 0
      ? ` with ${next.item.provenance.withUsers.join(', ')}`
      : ' alone';
  setStatus(`${next.item.name} — ${next.item.provenance.place}${withWhom}`);
}

// ── input: desktop ──────────────────────────────────────────────────────────────
const raycaster = new Raycaster();
const pointer = new Vector2(0, 0);
const keys = new Set<string>();
let yaw = 0;
let pitch = -0.07;
let dragging = false;

const canvas = renderer.domElement;
canvas.style.touchAction = 'none';

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (!dragging || renderer.xr.isPresenting) return;
  yaw -= e.movementX * 0.0032;
  pitch = Math.max(-1.1, Math.min(1.1, pitch - e.movementY * 0.0032));
});
canvas.addEventListener('click', () => {
  if (renderer.xr.isPresenting) return;
  select(pickFromCamera());
});
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function pickFromCamera(): PlacedItem | null {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(
    placed.map((p) => p.mesh),
    false,
  );
  const first = hits[0];
  if (!first) return null;
  return placed.find((p) => p.mesh === first.object) ?? null;
}

function moveRig(dt: number): void {
  const speed = (keys.has('shift') ? 3.2 : 1.7) * dt;
  const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const delta = new Vector3();

  if (keys.has('w') || keys.has('arrowup')) delta.add(forward);
  if (keys.has('s') || keys.has('arrowdown')) delta.sub(forward);
  if (keys.has('d') || keys.has('arrowright')) delta.add(right);
  if (keys.has('a') || keys.has('arrowleft')) delta.sub(right);

  if (delta.lengthSq() > 0) rig.position.add(delta.normalize().multiplyScalar(speed));

  // Keep the viewer inside the room. Walls you can walk through read as a bug.
  const limit = 0.6;
  rig.position.x = Math.max(
    -ROOM.width / 2 + limit,
    Math.min(ROOM.width / 2 - limit, rig.position.x),
  );
  rig.position.z = Math.max(
    -ROOM.depth / 2 + limit,
    Math.min(ROOM.depth / 2 - limit, rig.position.z),
  );
}

// ── input: VR ───────────────────────────────────────────────────────────────────
// Locomotion, comfort, grab and haptics live in xr-interaction.ts.
const grabbables: Grabbable[] = placed.map((p) => ({
  id: p.item.id,
  pivot: p.pivot,
  mesh: p.mesh,
  home: p.pivot.position.clone(),
}));

let heldId: string | null = null;

const xr = new XRInteraction({
  renderer,
  camera,
  rig,
  grabbables,
  onSelect: (id) => select(placed.find((p) => p.item.id === id) ?? null),
  onGrabChange: (id) => {
    heldId = id;
    if (id) {
      // Picking something up selects it: you are already looking at it, and the
      // provenance is the reason to pick it up at all.
      select(placed.find((p) => p.item.id === id) ?? null);
    }
  },
});

// ── chrome ──────────────────────────────────────────────────────────────────────
function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

// Show VR controls only when a headset is actually present, so a desktop visitor is
// not told to use a grip button they do not have.
void navigator.xr?.isSessionSupported?.('immersive-vr').then((supported) => {
  if (supported) document.body.classList.add('xr-capable');
});

const vrButton = VRButton.createButton(renderer);
vrButton.classList.add('gb-vr-button');
document.getElementById('vr-slot')?.appendChild(vrButton);

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  rig.position.set(0, 0, 1.4);
});
renderer.xr.addEventListener('sessionend', () => document.body.classList.remove('in-vr'));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── frame loop ──────────────────────────────────────────────────────────────────
let last = 0;
const cameraWorld = new Vector3();

renderer.setAnimationLoop((time) => {
  const dt = last === 0 ? 0.016 : Math.min((time - last) / 1000, 0.05);
  last = time;
  const t = time / 1000;

  if (!renderer.xr.isPresenting) {
    moveRig(dt);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  xr.update(dt);
  if (renderer.xr.isPresenting) xr.clampToRoom(ROOM.width / 2, ROOM.depth / 2);

  if (!reduceMotion) {
    hubCube.rotation.y += dt * 0.6;
    hubEdges.rotation.y = hubCube.rotation.y;
    hubCube.position.y = 0.62 + Math.sin(t * 0.8) * 0.02;
    hubEdges.position.y = hubCube.position.y;
  }

  for (const p of placed) {
    const isSelected = selected === p;
    const isHeld = heldId === p.item.id;
    // A held item follows the hand; idle bob would fight the grip.
    if (!reduceMotion && !isHeld) {
      p.pivot.position.y = p.baseY + Math.sin(t * 0.9 + p.phase) * 0.035;
      p.mesh.rotation.y += dt * (isSelected ? 0.85 : 0.28);
      p.mesh.rotation.x = Math.sin(t * 0.4 + p.phase) * 0.12;
    }
    p.halo.lookAt(camera.getWorldPosition(cameraWorld));
    const mat = p.mesh.material as MeshStandardMaterial;
    mat.emissiveIntensity +=
      ((isSelected ? 2.6 : 1.5) - mat.emissiveIntensity) * Math.min(dt * 6, 1);
  }

  // Billboards face the viewer, in both desktop and VR.
  camera.getWorldPosition(cameraWorld);
  (friend.userData.plate as Mesh).lookAt(cameraWorld);

  // While holding something, bring the card to the hand rather than leaving it
  // across the room — in VR you read it where you are looking.
  const heldPlaced = heldId ? placed.find((p) => p.item.id === heldId) : undefined;
  if (heldPlaced && card.visible) {
    const toViewer = new Vector3().subVectors(cameraWorld, heldPlaced.pivot.position).normalize();
    card.position
      .copy(heldPlaced.pivot.position)
      .addScaledVector(toViewer, -0.02)
      .add(new Vector3(0, 0.42, 0));
  }

  const targetOpacity = card.visible ? 1 : 0;
  cardOpacity += (targetOpacity - cardOpacity) * Math.min(dt * 7, 1);
  (card.material as MeshBasicMaterial).opacity = cardOpacity;
  if (card.visible) card.lookAt(cameraWorld);

  renderer.render(scene, camera);
});

// Preselect the hero item so the thesis is legible the moment the page loads.
select(placed[0] ?? null);

/** Small fill light used to make a flat panel read as lit rather than pasted on. */
function pinLight(position: Vector3, colour: string, intensity: number): PointLight {
  const light = new PointLight(new Color(colour), intensity, 4.5, 2);
  light.position.copy(position);
  return light;
}
