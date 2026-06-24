/** Deterministic per-team / per-player branding derived from a stable seed
 *  (team name, player id), so a club/player always renders in the same colour
 *  and crest across the dashboard and profile pages. */

const PALETTE = [
  "#2ee27a", "#4d7cff", "#ff5a5a", "#f5b53d", "#a78bfa", "#22d3ee",
  "#fb7185", "#34d399", "#f97316", "#60a5fa", "#e879f9", "#facc15",
];

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** A stable, pleasant hex colour for a seed. */
export function brandColor(seed: string): string {
  return PALETTE[hash(seed || "?") % PALETTE.length];
}

/** Up to two initials for a crest / avatar. */
export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
