import type { PlayerStat } from "../types";
import { Avatar } from "./ui";

/* Broadcast-style player head-to-head (mirrors the bein-sports comparison
 * graphic): two players, a metric per row, the leader's value highlighted. */

type Row = { label: string; get: (p: PlayerStat) => number; fmt: (n: number) => string; better?: "high" | "low" };

const ROWS: Row[] = [
  { label: "Distance (km)", get: (p) => p.distance_m / 1000, fmt: (n) => n.toFixed(1) },
  { label: "Top speed (km/h)", get: (p) => p.top_speed_ms * 3.6, fmt: (n) => n.toFixed(1) },
  { label: "Sprints", get: (p) => p.sprints ?? 0, fmt: (n) => String(n) },
  { label: "Touches", get: (p) => p.touches ?? 0, fmt: (n) => String(n) },
  { label: "Passes completed", get: (p) => p.passes ?? 0, fmt: (n) => String(n) },
  { label: "Pass accuracy", get: (p) => p.pass_accuracy ?? 0, fmt: (n) => `${n}%` },
  { label: "Attempts (shots)", get: (p) => p.shots ?? 0, fmt: (n) => String(n) },
  { label: "Expected goals", get: (p) => p.xg ?? 0, fmt: (n) => n.toFixed(2) },
];

function name(p: PlayerStat) {
  return typeof p.player_id === "string" && p.player_id.includes("#")
    ? p.player_id
    : `#${p.jersey ?? p.player_id}`;
}

export default function HeadToHead({ a, b, colorA, colorB }: {
  a: PlayerStat; b: PlayerStat; colorA: string; colorB: string;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Avatar label={String(a.jersey ?? "?")} color={colorA} size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name(a)}</div>
            <div className="text-xs text-mute">{a.team}</div>
          </div>
        </div>
        <span className="rounded-full bg-line px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-mute">vs</span>
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 text-right">
            <div className="truncate text-sm font-semibold">{name(b)}</div>
            <div className="text-xs text-mute">{b.team}</div>
          </div>
          <Avatar label={String(b.jersey ?? "?")} color={colorB} size={40} />
        </div>
      </div>

      <div className="divide-y divide-line/60">
        {ROWS.map((r) => {
          const va = r.get(a);
          const vb = r.get(b);
          const max = Math.max(va, vb, 0.0001);
          const aWins = r.better === "low" ? va < vb : va > vb;
          const bWins = r.better === "low" ? vb < va : vb > va;
          return (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2">
              <div className="flex items-center justify-end gap-2">
                <span className={`tnum text-sm font-semibold ${aWins ? "" : "text-mute"}`} style={aWins ? { color: colorA } : undefined}>
                  {r.fmt(va)}
                </span>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                  <div className="ml-auto h-full rounded-full" style={{ width: `${(va / max) * 100}%`, background: colorA, float: "right" }} />
                </div>
              </div>
              <span className="whitespace-nowrap text-center text-[0.7rem] uppercase tracking-wide text-mute">{r.label}</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full" style={{ width: `${(vb / max) * 100}%`, background: colorB }} />
                </div>
                <span className={`tnum text-sm font-semibold ${bWins ? "" : "text-mute"}`} style={bWins ? { color: colorB } : undefined}>
                  {r.fmt(vb)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
