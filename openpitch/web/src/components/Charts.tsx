import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { JobSummary } from "../types";

const HOME = "#ff5a5a";
const AWAY = "#4d7cff";
const PITCH = "#2ee27a";
const GRID = "#1e2632";
const AXIS = "#7c8a9c";

const axis = { stroke: "transparent", tick: { fill: AXIS, fontSize: 11 }, tickLine: false } as const;

interface TipPayload {
  name: string;
  value: number | string;
  color?: string;
}

function Tip({ active, payload, label, unit }: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-2 bg-ink-2/95 px-3 py-2 text-xs shadow-pop backdrop-blur">
      {label !== undefined && <p className="mb-1 font-medium text-slate-200">{label}{unit}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tnum flex items-center gap-1.5 text-slate-300">
          {p.color && <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />}
          {p.name}: <b className="text-white">{p.value}</b>
        </p>
      ))}
    </div>
  );
}

export function PossessionTimeline({ summary }: { summary: JobSummary }) {
  const data = summary.possession_timeline;
  const [home, away] = Object.keys(summary.possession);
  if (data.length < 2) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="gHome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={HOME} stopOpacity={0.45} />
            <stop offset="100%" stopColor={HOME} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gAway" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AWAY} stopOpacity={0.45} />
            <stop offset="100%" stopColor={AWAY} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" unit="s" {...axis} />
        <YAxis domain={[0, 100]} unit="%" {...axis} />
        <Tooltip content={<Tip unit="s" />} />
        <Area type="monotone" dataKey="home" name={home} stroke={HOME} strokeWidth={2} fill="url(#gHome)" />
        <Area type="monotone" dataKey="away" name={away} stroke={AWAY} strokeWidth={2} fill="url(#gAway)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SpeedDistribution({ summary }: { summary: JobSummary }) {
  const bins = [0, 2, 4, 6, 8, 10, 12];
  const data = bins.slice(0, -1).map((lo, i) => {
    const hi = bins[i + 1];
    return {
      range: `${lo}–${hi}`,
      count: summary.players.filter((p) => p.top_speed_ms >= lo && p.top_speed_ms < hi).length,
    };
  });
  if (summary.players.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <defs>
          <linearGradient id="gSpeed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PITCH} stopOpacity={0.95} />
            <stop offset="100%" stopColor={PITCH} stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="range" unit=" m/s" {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey="count" name="players" fill="url(#gSpeed)" radius={[5, 5, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DistanceChart({ summary }: { summary: JobSummary }) {
  const [home] = Object.keys(summary.possession);
  const data = summary.players
    .slice()
    .sort((a, b) => b.distance_m - a.distance_m)
    .slice(0, 8)
    .map((p) => ({ name: `#${p.jersey ?? p.player_id}`, distance: +(p.distance_m / 1000).toFixed(2), team: p.team }));
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" {...axis} />
        <YAxis unit="km" {...axis} />
        <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey="distance" name="km" radius={[5, 5, 0, 0]} maxBarSize={40}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.team === home ? HOME : AWAY} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Top ball-progressors by expected-threat added (event model). */
export function XtLeaders({ summary }: { summary: JobSummary }) {
  const [home] = Object.keys(summary.possession);
  const data = summary.players
    .filter((p) => (p.xt_added ?? 0) !== 0)
    .sort((a, b) => (b.xt_added ?? 0) - (a.xt_added ?? 0))
    .slice(0, 7)
    .map((p) => ({ name: `#${p.jersey ?? p.player_id}`, xt: +(p.xt_added ?? 0).toFixed(3), team: p.team }));
  if (data.length === 0) return <Empty title="No threat-creating passes yet" hint="xT appears once players string passes toward goal — point it at real match footage." />;
  return <HBars data={data} dataKey="xt" name="xT" home={home} />;
}

/** Fallback involvement chart: most-touched players (always has data when the
 *  ball is tracked), so the card never sits empty on quiet clips. */
export function TouchLeaders({ summary }: { summary: JobSummary }) {
  const [home] = Object.keys(summary.possession);
  const data = summary.players
    .filter((p) => (p.touches ?? 0) > 0)
    .sort((a, b) => (b.touches ?? 0) - (a.touches ?? 0))
    .slice(0, 7)
    .map((p) => ({ name: `#${p.jersey ?? p.player_id}`, touches: p.touches ?? 0, team: p.team }));
  if (data.length === 0) return <Empty title="No on-ball involvement yet" hint="Touches register once the ball is consistently tracked near players." />;
  return <HBars data={data} dataKey="touches" name="touches" home={home} />;
}

/** Shared horizontal-bar renderer for the leader charts. */
function HBars({ data, dataKey, name, home }: {
  data: { name: string; team: string }[] & Record<string, unknown>[];
  dataKey: string;
  name: string;
  home: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 12, bottom: 0, left: 6 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axis} />
        <YAxis type="category" dataKey="name" width={42} {...axis} />
        <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey={dataKey} name={name} radius={[0, 5, 5, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.team === home ? HOME : AWAY} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty({ title, hint }: { title?: string; hint?: string }) {
  return (
    <div className="flex h-[210px] flex-col items-center justify-center gap-2 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-line/60 text-mute">
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 14l3-3 3 3 5-6" />
        </svg>
      </span>
      <p className="text-sm font-medium text-slate-300">{title ?? "Not enough data yet"}</p>
      {hint && <p className="max-w-[15rem] text-xs text-mute">{hint}</p>}
    </div>
  );
}
