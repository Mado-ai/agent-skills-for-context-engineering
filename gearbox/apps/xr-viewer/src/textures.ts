/**
 * Procedural surface textures, drawn to canvas.
 *
 * The brand's rooms are warm wood, cream plaster, and daylight. Generating the two
 * textures that carry that (floor planks, windows) costs a few kilobytes of code
 * instead of shipping image assets, and keeps the build single-file.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/** Deterministic PRNG so the floor looks identical on every load. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Warm oak planks, matching the brand renders' floors. */
export function woodFloorTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const rand = lcg(7);
  ctx.fillStyle = '#ad7f53';
  ctx.fillRect(0, 0, size, size);

  const rows = 8;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    // Per-plank tone variation.
    let x = -Math.floor(rand() * 120);
    while (x < size) {
      const w = 120 + Math.floor(rand() * 110);
      const tone = 0.88 + rand() * 0.24;
      const base = [173, 127, 83] as const;
      ctx.fillStyle = `rgb(${Math.round(base[0] * tone)}, ${Math.round(base[1] * tone)}, ${Math.round(base[2] * tone)})`;
      ctx.fillRect(x, r * rowH, w, rowH);

      // Plank-end seam.
      ctx.fillStyle = 'rgba(90, 62, 38, 0.55)';
      ctx.fillRect(x + w - 2, r * rowH, 2, rowH);
      x += w;
    }
    // Row seam.
    ctx.fillStyle = 'rgba(90, 62, 38, 0.6)';
    ctx.fillRect(0, r * rowH - 1, size, 2);

    // Faint grain streaks.
    for (let g = 0; g < 10; g++) {
      const gy = r * rowH + rand() * rowH;
      ctx.strokeStyle = `rgba(120, 85, 52, ${0.06 + rand() * 0.08})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(size * 0.3, gy + rand() * 4 - 2, size * 0.7, gy + rand() * 4 - 2, size, gy);
      ctx.stroke();
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.anisotropy = 8;
  return tex;
}

/** Arched window with warm daylight — most of what makes the room read as a home. */
export function windowTexture(): CanvasTexture {
  const W = 512;
  const H = 768;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  // Frame.
  ctx.fillStyle = '#f4efe3';
  ctx.fillRect(0, 0, W, H);

  // Pane area: arch top.
  const inset = 30;
  const radius = W / 2 - inset;
  const archCenterY = inset + radius;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(inset, H - inset);
  ctx.lineTo(inset, archCenterY);
  ctx.arc(W / 2, archCenterY, radius, Math.PI, 0);
  ctx.lineTo(W - inset, H - inset);
  ctx.closePath();
  ctx.clip();

  // Sky: bright day into a warm horizon.
  const sky = ctx.createLinearGradient(0, inset, 0, H - inset);
  sky.addColorStop(0, '#bfe2f4');
  sky.addColorStop(0.55, '#dcedf2');
  sky.addColorStop(0.8, '#f6e8cd');
  sky.addColorStop(1, '#efdcb4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Soft sun glow.
  const glow = ctx.createRadialGradient(W * 0.68, H * 0.3, 10, W * 0.68, H * 0.3, 200);
  glow.addColorStop(0, 'rgba(255, 245, 214, 0.9)');
  glow.addColorStop(1, 'rgba(255, 245, 214, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Distant treeline, softly out of focus.
  ctx.fillStyle = 'rgba(122, 148, 110, 0.5)';
  for (let i = 0; i < 6; i++) {
    const tx = 40 + i * 82;
    const ty = H * 0.72;
    ctx.beginPath();
    ctx.arc(tx, ty, 46, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(101, 129, 92, 0.55)';
  ctx.fillRect(0, H * 0.76, W, H);

  ctx.restore();

  // Mullions.
  ctx.fillStyle = '#f4efe3';
  ctx.fillRect(W / 2 - 7, inset, 14, H - inset * 2);
  ctx.fillRect(inset, archCenterY - 7, W - inset * 2, 14);
  ctx.fillRect(inset, H * 0.66, W - inset * 2, 14);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
