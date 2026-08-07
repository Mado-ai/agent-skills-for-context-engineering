/**
 * Canvas-drawn textures for in-world text.
 *
 * All type in the scene is drawn here rather than by a text-mesh library: it keeps the
 * bundle small, stays crisp at the distances people actually read from in VR, and lets
 * the provenance card use a genuine field-log layout — monospace data under a grotesk
 * heading, which is the typographic idea the whole piece is built on.
 */

import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

export const PALETTE = {
  navy: '#0e1626',
  slate: '#39424e',
  brass: '#e2a44a',
  seaGlass: '#5fa8a0',
  bone: '#ede9e2',
  boneDim: 'rgba(237, 233, 226, 0.62)',
  boneFaint: 'rgba(237, 233, 226, 0.34)',
} as const;

const DISPLAY = '600 {size}px ui-sans-serif, "Helvetica Neue", Helvetica, Arial, sans-serif';
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

/** Small plinth nameplate. Reads at ~1.5 m. */
export function nameplateTexture(name: string, place: string): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 160);

  ctx.font = font(DISPLAY, 44);
  ctx.fillStyle = PALETTE.bone;
  ctx.textBaseline = 'top';
  ctx.fillText(name, 24, 26);

  ctx.font = font(MONO, 26, 400);
  ctx.fillStyle = PALETTE.boneDim;
  ctx.fillText(place.toUpperCase(), 24, 88);

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
 * Laid out as a field-log entry: grotesk heading, monospace record beneath.
 */
export function provenanceTexture(c: ProvenanceContent): CanvasTexture {
  const W = 900;
  const H = 620;
  const [canvas, ctx] = makeCanvas(W, H);

  ctx.fillStyle = 'rgba(14, 22, 38, 0.94)';
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.fill();

  ctx.strokeStyle = 'rgba(226, 164, 74, 0.5)';
  ctx.lineWidth = 3;
  roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 28);
  ctx.stroke();

  // Brass rule — the only ornament, and it marks the split between name and record.
  ctx.fillStyle = PALETTE.brass;
  ctx.fillRect(48, 150, 120, 4);

  ctx.textBaseline = 'top';

  ctx.font = font(MONO, 24, 500);
  ctx.fillStyle = PALETTE.brass;
  ctx.letterSpacing = '3px';
  ctx.fillText('COLLECTED ITEM', 48, 46);
  ctx.letterSpacing = '0px';

  ctx.font = font(DISPLAY, 58);
  ctx.fillStyle = PALETTE.bone;
  ctx.fillText(c.name, 48, 84);

  const rows: Array<[string, string]> = [
    ['place', c.place],
    ['area', c.area],
    ['position', `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`],
    ['h3 r9', c.h3r9],
    ['collected', c.collectedAt],
    ['with', c.withUsers.length > 0 ? c.withUsers.join('  ') : '— alone'],
  ];

  let y = 196;
  for (const [label, value] of rows) {
    ctx.font = font(MONO, 26, 400);
    ctx.fillStyle = PALETTE.boneFaint;
    ctx.fillText(label.toUpperCase(), 48, y);

    ctx.font = font(MONO, 30, 500);
    ctx.fillStyle = label === 'with' && c.withUsers.length > 0 ? PALETTE.seaGlass : PALETTE.bone;
    ctx.fillText(value, 300, y - 2);

    y += 62;
  }

  ctx.font = font(MONO, 22, 400);
  ctx.fillStyle = PALETTE.boneFaint;
  ctx.fillText('© OpenStreetMap contributors', 48, H - 62);

  return toTexture(canvas);
}

export interface DashboardContent {
  title: string;
  stats: ReadonlyArray<{ label: string; value: string }>;
  footnote: string;
}

/** Wall-mounted spatial app. Deliberately reads as software, not as a poster. */
export function dashboardTexture(d: DashboardContent): CanvasTexture {
  const W = 1024;
  const H = 640;
  const [canvas, ctx] = makeCanvas(W, H);

  ctx.fillStyle = 'rgba(12, 19, 32, 0.96)';
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(95, 168, 160, 0.45)';
  ctx.lineWidth = 3;
  roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 20);
  ctx.stroke();

  ctx.textBaseline = 'top';

  ctx.font = font(MONO, 24, 500);
  ctx.fillStyle = PALETTE.seaGlass;
  ctx.letterSpacing = '4px';
  ctx.fillText('SPATIAL APP', 56, 48);
  ctx.letterSpacing = '0px';

  ctx.font = font(DISPLAY, 62);
  ctx.fillStyle = PALETTE.bone;
  ctx.fillText(d.title, 56, 86);

  // Two-column stat grid. Tabular figures matter: these line up.
  const colX = [56, 552];
  const rowY = [212, 384];
  d.stats.forEach((stat, i) => {
    const x = colX[i % 2] as number;
    const y = rowY[Math.floor(i / 2)] as number;

    ctx.font = font(MONO, 84, 600);
    ctx.fillStyle = PALETTE.bone;
    ctx.fillText(stat.value, x, y);

    ctx.font = font(MONO, 24, 400);
    ctx.fillStyle = PALETTE.boneFaint;
    ctx.letterSpacing = '2px';
    ctx.fillText(stat.label.toUpperCase(), x, y + 100);
    ctx.letterSpacing = '0px';
  });

  ctx.fillStyle = 'rgba(95, 168, 160, 0.28)';
  ctx.fillRect(56, H - 108, W - 112, 2);

  ctx.font = font(MONO, 24, 400);
  ctx.fillStyle = PALETTE.boneDim;
  ctx.fillText(d.footnote, 56, H - 82);

  return toTexture(canvas);
}

/** Floating nameplate above a remote participant. */
export function presenceTexture(handle: string, status: string): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 140);

  ctx.fillStyle = 'rgba(14, 22, 38, 0.88)';
  roundRect(ctx, 0, 0, 512, 140, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(95, 168, 160, 0.5)';
  ctx.lineWidth = 3;
  roundRect(ctx, 1.5, 1.5, 509, 137, 20);
  ctx.stroke();

  ctx.textBaseline = 'top';
  ctx.font = font(DISPLAY, 42);
  ctx.fillStyle = PALETTE.bone;
  ctx.fillText(handle, 28, 24);

  ctx.font = font(MONO, 24, 400);
  ctx.fillStyle = PALETTE.seaGlass;
  ctx.fillText(status.toUpperCase(), 28, 82);

  return toTexture(canvas);
}
