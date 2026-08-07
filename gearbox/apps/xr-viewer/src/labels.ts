/**
 * Canvas-drawn textures for in-world text.
 *
 * All type in the scene is drawn here rather than by a text-mesh library: it keeps the
 * bundle small, stays crisp at the distances people actually read from in VR, and lets
 * the provenance card keep a genuine field-log layout — a friendly rounded heading
 * over a monospace record.
 *
 * Restyled to the GearBox brand: white rounded cards on a warm room, ink text, the
 * green as the one accent — the same card language as the dashboard mocks.
 */

import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

export const PALETTE = {
  cream: '#f0ece3',
  card: 'rgba(251, 250, 246, 0.97)',
  ink: '#232a20',
  muted: '#6d7365',
  faint: '#a4a998',
  green: '#3d9c50',
  greenBright: '#46a758',
  greenTint: '#e5f2e6',
  amber: '#e39a33',
  border: 'rgba(35, 42, 32, 0.14)',
} as const;

const DISPLAY =
  '600 {size}px ui-rounded, "SF Pro Rounded", ui-sans-serif, "Helvetica Neue", Arial, sans-serif';
const MONO = '{weight} {size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function font(spec: string, size: number, weight = 400): string {
  return spec.replace('{size}', String(size)).replace('{weight}', String(weight));
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 8;
  return tex;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** White card base shared by every panel — the brand's one card language. */
function cardBase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  r: number,
  borderColor: string = PALETTE.border,
): void {
  ctx.fillStyle = PALETTE.card;
  roundRect(ctx, 0, 0, w, h, r);
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, r);
  ctx.stroke();
}

/** Small plinth nameplate. Reads at ~1.5 m. */
export function nameplateTexture(name: string, place: string): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 160);
  cardBase(ctx, 512, 160, 26);

  ctx.textBaseline = 'top';

  ctx.font = font(DISPLAY, 44);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(name, 30, 28);

  ctx.font = font(MONO, 24, 500);
  ctx.fillStyle = PALETTE.green;
  ctx.letterSpacing = '2px';
  ctx.fillText(place.toUpperCase(), 30, 92);
  ctx.letterSpacing = '0px';

  return toTexture(canvas);
}

export interface ProvenanceContent {
  name: string;
  place: string;
  area: string;
  lat: number;
  lon: number;
  h3r9: string;
  collectedAt: string;
  withUsers: readonly string[];
}

/**
 * The provenance card — the thesis of the whole scene made legible.
 * A field-log entry on a friendly white card: rounded heading, monospace record.
 */
export function provenanceTexture(c: ProvenanceContent): CanvasTexture {
  const W = 900;
  const H = 620;
  const [canvas, ctx] = makeCanvas(W, H);
  cardBase(ctx, W, H, 32, 'rgba(61, 156, 80, 0.4)');

  ctx.textBaseline = 'top';

  // Green pill eyebrow, matching the dashboard chips.
  ctx.fillStyle = PALETTE.greenTint;
  roundRect(ctx, 48, 40, 268, 46, 23);
  ctx.fill();
  ctx.font = font(MONO, 23, 600);
  ctx.fillStyle = PALETTE.green;
  ctx.letterSpacing = '3px';
  ctx.fillText('COLLECTED ITEM', 72, 52);
  ctx.letterSpacing = '0px';

  ctx.font = font(DISPLAY, 58);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(c.name, 48, 104);

  // Green rule marks the split between name and record.
  ctx.fillStyle = PALETTE.greenBright;
  ctx.fillRect(48, 178, 120, 5);

  const rows: Array<[string, string]> = [
    ['place', c.place],
    ['area', c.area],
    ['position', `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`],
    ['h3 r9', c.h3r9],
    ['collected', c.collectedAt],
    ['with', c.withUsers.length > 0 ? c.withUsers.join('  ') : '— alone'],
  ];

  let y = 212;
  for (const [label, value] of rows) {
    ctx.font = font(MONO, 25, 400);
    ctx.fillStyle = PALETTE.faint;
    ctx.fillText(label.toUpperCase(), 48, y);

    ctx.font = font(MONO, 30, 500);
    ctx.fillStyle = label === 'with' && c.withUsers.length > 0 ? PALETTE.green : PALETTE.ink;
    ctx.fillText(value, 300, y - 2);

    y += 58;
  }

  ctx.font = font(MONO, 21, 400);
  ctx.fillStyle = PALETTE.faint;
  ctx.fillText('© OpenStreetMap contributors', 48, H - 56);

  return toTexture(canvas);
}

export interface DashboardContent {
  title: string;
  stats: ReadonlyArray<{ label: string; value: string }>;
  footnote: string;
}

/** Wall-mounted spatial app — the brand's white stat card, hung in the room. */
export function dashboardTexture(d: DashboardContent): CanvasTexture {
  const W = 1024;
  const H = 640;
  const [canvas, ctx] = makeCanvas(W, H);
  cardBase(ctx, W, H, 28);

  ctx.textBaseline = 'top';

  ctx.fillStyle = PALETTE.greenTint;
  roundRect(ctx, 56, 44, 224, 44, 22);
  ctx.fill();
  ctx.font = font(MONO, 22, 600);
  ctx.fillStyle = PALETTE.green;
  ctx.letterSpacing = '4px';
  ctx.fillText('SPATIAL APP', 82, 55);
  ctx.letterSpacing = '0px';

  ctx.font = font(DISPLAY, 60);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(d.title, 56, 104);

  // Two-column stat grid. Tabular figures matter: these line up.
  const colX = [56, 552];
  const rowY = [222, 388];
  d.stats.forEach((stat, i) => {
    const x = colX[i % 2] as number;
    const y = rowY[Math.floor(i / 2)] as number;

    ctx.font = font(MONO, 80, 600);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(stat.value, x, y);

    ctx.font = font(MONO, 23, 500);
    ctx.fillStyle = PALETTE.muted;
    ctx.letterSpacing = '2px';
    ctx.fillText(stat.label.toUpperCase(), x, y + 96);
    ctx.letterSpacing = '0px';
  });

  ctx.fillStyle = 'rgba(35, 42, 32, 0.1)';
  ctx.fillRect(56, H - 104, W - 112, 2);

  // Green status dot before the footnote — state encoded in form, not just words.
  ctx.fillStyle = PALETTE.greenBright;
  ctx.beginPath();
  ctx.arc(66, H - 62, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = font(MONO, 23, 400);
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText(d.footnote, 88, H - 74);

  return toTexture(canvas);
}

/** Floating nameplate above a remote participant. */
export function presenceTexture(handle: string, status: string): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 140);
  cardBase(ctx, 512, 140, 28, 'rgba(61, 156, 80, 0.35)');

  ctx.textBaseline = 'top';
  ctx.font = font(DISPLAY, 42);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(handle, 30, 24);

  ctx.fillStyle = PALETTE.greenBright;
  ctx.beginPath();
  ctx.arc(38, 96, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = font(MONO, 23, 500);
  ctx.fillStyle = PALETTE.green;
  ctx.fillText(status.toUpperCase(), 56, 84);

  return toTexture(canvas);
}
