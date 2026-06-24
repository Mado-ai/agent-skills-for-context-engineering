import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { JobSummary, PassNetwork as PassNet } from "../types";
import { cx } from "../lib/cx";

const HOME = "#ff5a5a";
const AWAY = "#4d7cff";
const LINE = "#2b3543";
const TURF = "#0f1a12";

/** Pitch dimensions in SVG units (length x width); markings drawn to scale. */
const L = 100;
const W = 64;

/** Reusable vector pitch with standard markings, attacking left → right. */
function Pitch({ children, flip = false }: { children?: React.ReactNode; flip?: boolean }) {
  return (
    <svg viewBox={`0 0 ${L} ${W}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#13241a" />
          <stop offset="100%" stopColor={TURF} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={L} height={W} rx={2} fill="url(#turf)" />
      {/* faint mowing stripes */}
      {Array.from({ length: 8 }).map((_, i) =>
        i % 2 === 0 ? (
          <rect key={i} x={(i * L) / 8} y={0} width={L / 8} height={W} fill="#ffffff05" />
        ) : null,
      )}
      <g stroke={LINE} strokeWidth={0.4} fill="none" opacity={0.9}>
        <rect x={1.5} y={1.5} width={L - 3} height={W - 3} />
        <line x1={L / 2} y1={1.5} x2={L / 2} y2={W - 1.5} />
        <circle cx={L / 2} cy={W / 2} r={9.15} />
        <circle cx={L / 2} cy={W / 2} r={0.6} fill={LINE} />
        {/* penalty + 6-yard boxes, both ends */}
        <rect x={1.5} y={W / 2 - 20.16} width={16.5} height={40.32} />
        <rect x={1.5} y={W / 2 - 9.16} width={5.5} height={18.32} />
        <rect x={L - 18} y={W / 2 - 20.16} width={16.5} height={40.32} />
        <rect x={L - 7} y={W / 2 - 9.16} width={5.5} height={18.32} />
        <circle cx={11} cy={W / 2} r={0.6} fill={LINE} />
        <circle cx={L - 11} cy={W / 2} r={0.6} fill={LINE} />
      </g>
      {flip && (
        <text x={L - 3} y={5} fontSize={2.6} fill="#7c8a9c" textAnchor="end">
          attack →
        </text>
      )}
      {children}
    </svg>
  );
}

/** Shot map — dots placed by location, area scaled by xG, goals ringed. */
export function ShotMap({ summary }: { summary: JobSummary }) {
  const teams = Object.keys(summary.possession);
  const [home] = teams;
  const shots = summary.shots ?? [];
  if (shots.length === 0)
    return (
      <Hollow
        title="No shots detected"
        hint="Shots register when a possession ends with the ball driven at goal — point it at match footage for a fuller map."
      />
    );
  // xn is in attacking direction (0 = own goal → 1 = target). Plot every team
  // attacking left→right so the map reads like a single attacking picture.
  return (
    <div>
      <Pitch flip>
        {shots.map((sh, i) => {
          const r = 0.8 + Math.sqrt(Math.max(0, sh.xg)) * 6.5;
          const col = sh.team === home ? HOME : AWAY;
          return (
            <g key={i}>
              <circle
                cx={3 + sh.xn * (L - 6)}
                cy={3 + sh.yn * (W - 6)}
                r={r}
                fill={col}
                fillOpacity={0.28}
                stroke={col}
                strokeWidth={0.4}
              />
            </g>
          );
        })}
      </Pitch>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-mute">
        <div className="flex items-center gap-3">
          {teams.map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t === home ? HOME : AWAY }} />
              {t}: <b className="tnum text-slate-300">{shots.filter((x) => x.team === t).length}</b>
            </span>
          ))}
        </div>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-mute/50" />
          <span className="h-3.5 w-3.5 rounded-full bg-mute/40" /> dot size = xG
        </span>
      </div>
    </div>
  );
}

/** Cumulative expected-goals race over match time, one line per team. */
export function CumulativeXg({ summary }: { summary: JobSummary }) {
  const teams = Object.keys(summary.possession);
  const [home, away] = teams;
  const data = useMemo(() => {
    const shots = (summary.shots ?? []).slice().sort((a, b) => a.t - b.t);
    if (shots.length === 0) return [];
    const acc: Record<string, number> = { [home]: 0, [away]: 0 };
    const rows: { t: number; home: number; away: number }[] = [
      { t: 0, home: 0, away: 0 },
    ];
    for (const sh of shots) {
      if (sh.team === home) acc[home] += sh.xg;
      else acc[away] += sh.xg;
      rows.push({
        t: +(sh.t / 60).toFixed(2),
        home: +acc[home].toFixed(3),
        away: +acc[away].toFixed(3),
      });
    }
    return rows;
  }, [summary.shots, home, away]);

  if (data.length < 2)
    return <Hollow title="No xG timeline yet" hint="Two or more shots are needed to chart the cumulative-xG race." />;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
        <CartesianGrid stroke="#1e2632" vertical={false} />
        <XAxis dataKey="t" unit="'" tick={{ fill: "#7c8a9c", fontSize: 11 }} tickLine={false} stroke="transparent" />
        <YAxis tick={{ fill: "#7c8a9c", fontSize: 11 }} tickLine={false} stroke="transparent" />
        <Tooltip
          contentStyle={{ background: "#11161dF2", border: "1px solid #2b3543", borderRadius: 10, fontSize: 12 }}
          labelFormatter={(v) => `${v}'`}
        />
        <Line type="stepAfter" dataKey="home" name={home} stroke={HOME} strokeWidth={2.2} dot={false} />
        <Line type="stepAfter" dataKey="away" name={away} stroke={AWAY} strokeWidth={2.2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Average-position passing network for one team (node = avg spot, edge = pair volume). */
export function PassNetwork({ summary }: { summary: JobSummary }) {
  const teams = Object.keys(summary.possession);
  const [picked, setPicked] = useState(teams[0]);
  const net: PassNet | undefined = summary.pass_network?.[picked];
  const col = picked === teams[0] ? HOME : AWAY;
  const nodes = net?.nodes ?? [];
  const edges = net?.edges ?? [];
  const byJersey = useMemo(() => {
    const m = new Map<number, { x: number; y: number; passes: number }>();
    for (const n of nodes) m.set(n.jersey, n);
    return m;
  }, [nodes]);
  const maxPass = Math.max(1, ...nodes.map((n) => n.passes));
  const maxEdge = Math.max(1, ...edges.map((e) => e.count));

  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {teams.map((t) => (
          <button
            key={t}
            onClick={() => setPicked(t)}
            className={cx(
              "rounded-full px-3 py-1 text-xs font-medium transition",
              t === picked ? "bg-white/10 text-white" : "text-mute hover:text-slate-300",
            )}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: t === teams[0] ? HOME : AWAY }}
            />
            {t}
          </button>
        ))}
      </div>
      {nodes.length === 0 ? (
        <Hollow
          title="No passing network yet"
          hint="A network appears once players with stable jersey numbers complete passes between each other."
        />
      ) : (
        <Pitch>
          {edges.map((e, i) => {
            const a = byJersey.get(e.a);
            const b = byJersey.get(e.b);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={3 + a.x * (L - 6)}
                y1={3 + a.y * (W - 6)}
                x2={3 + b.x * (L - 6)}
                y2={3 + b.y * (W - 6)}
                stroke={col}
                strokeOpacity={0.18 + 0.5 * (e.count / maxEdge)}
                strokeWidth={0.4 + 2.2 * (e.count / maxEdge)}
              />
            );
          })}
          {nodes.map((n, i) => {
            const r = 1.8 + 3.2 * (n.passes / maxPass);
            return (
              <g key={i}>
                <circle cx={3 + n.x * (L - 6)} cy={3 + n.y * (W - 6)} r={r} fill={col} fillOpacity={0.85} />
                <text
                  x={3 + n.x * (L - 6)}
                  y={3 + n.y * (W - 6) + 1}
                  fontSize={2.4}
                  fill="#0b0f14"
                  fontWeight={700}
                  textAnchor="middle"
                >
                  {n.jersey}
                </text>
              </g>
            );
          })}
        </Pitch>
      )}
    </div>
  );
}

/** 18-cell territory heat (3 width × 6 length) per team. */
export function Territory({ summary }: { summary: JobSummary }) {
  const teams = Object.keys(summary.possession);
  const [picked, setPicked] = useState(teams[0]);
  const grid = summary.zones?.[picked] ?? [];
  const col = picked === teams[0] ? HOME : AWAY;
  const max = Math.max(0.001, ...grid);
  if (grid.length === 0)
    return <Hollow title="No territory data" hint="Territory builds up from tracked player positions across the match." />;
  // grid index = band(0..2 width) * 6 + col(0..5 length); render length left→right.
  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {teams.map((t) => (
          <button
            key={t}
            onClick={() => setPicked(t)}
            className={cx(
              "rounded-full px-3 py-1 text-xs font-medium transition",
              t === picked ? "bg-white/10 text-white" : "text-mute hover:text-slate-300",
            )}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: t === teams[0] ? HOME : AWAY }}
            />
            {t}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        {[0, 1, 2].map((band) => (
          <div key={band} className="grid grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((cInd) => {
              const v = grid[band * 6 + cInd] ?? 0;
              const pct = Math.round((v / (max || 1)) * 100);
              return (
                <div
                  key={cInd}
                  className="relative aspect-[3/2] border border-ink/40"
                  style={{ background: col, opacity: 0.08 + 0.8 * (v / max) }}
                  title={`${(v * 100).toFixed(1)}% of positions`}
                >
                  <span className="absolute inset-0 grid place-items-center text-[0.6rem] font-semibold text-white/80">
                    {pct > 12 ? `${(v * 100).toFixed(0)}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-mute">
        Share of {picked}'s tracked positions per third of the pitch · own half on the left.
      </p>
    </div>
  );
}

function Hollow({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-[230px] flex-col items-center justify-center gap-2 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-line/60 text-mute">
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={12} cy={12} r={9} />
          <path d="M12 8v5l3 2" />
        </svg>
      </span>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="max-w-[16rem] text-xs text-mute">{hint}</p>}
    </div>
  );
}
