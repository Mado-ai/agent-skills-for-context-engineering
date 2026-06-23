import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Benchmark, TrendPoint } from "../types";
import { cx } from "../lib/cx";

const ACCENT = "#2ee27a";

type MetricKey = "distance_m" | "top_speed_ms" | "sprints" | "passes" | "goals";
const METRICS: { key: MetricKey; label: string; fmt: (v: number) => string }[] = [
  { key: "distance_m", label: "Distance", fmt: (v) => `${(v / 1000).toFixed(1)} km` },
  { key: "top_speed_ms", label: "Top speed", fmt: (v) => `${v} m/s` },
  { key: "sprints", label: "Sprints", fmt: (v) => `${v}` },
  { key: "passes", label: "Passes", fmt: (v) => `${v}` },
  { key: "goals", label: "Goals", fmt: (v) => `${v}` },
];

/** Match-by-match form, one selectable metric, oldest → newest. */
export function FormTrends({ trends, color = ACCENT }: { trends: TrendPoint[]; color?: string }) {
  const [metric, setMetric] = useState<MetricKey>("distance_m");
  const m = METRICS.find((x) => x.key === metric)!;
  if (trends.length < 2)
    return (
      <p className="py-8 text-center text-sm text-mute">
        Two or more matches are needed to chart form trends.
      </p>
    );
  const data = trends.map((t, i) => ({
    i: i + 1,
    label: t.opponent || t.played_on || `M${i + 1}`,
    value:
      metric === "distance_m"
        ? +(t.distance_m / 1000).toFixed(2)
        : (t[metric] as number) ?? 0,
  }));
  const avg = data.reduce((s, d) => s + d.value, 0) / data.length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {METRICS.map((x) => (
          <button
            key={x.key}
            onClick={() => setMetric(x.key)}
            className={cx(
              "rounded-full px-2.5 py-1 text-xs font-medium transition",
              x.key === metric ? "bg-white/10 text-white" : "text-mute hover:text-slate-300",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
          <defs>
            <linearGradient id="gForm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e2632" vertical={false} />
          <XAxis dataKey="i" tick={{ fill: "#7c8a9c", fontSize: 11 }} tickLine={false} stroke="transparent" />
          <YAxis tick={{ fill: "#7c8a9c", fontSize: 11 }} tickLine={false} stroke="transparent" />
          <Tooltip
            contentStyle={{ background: "#11161dF2", border: "1px solid #2b3543", borderRadius: 10, fontSize: 12 }}
            formatter={(v) => [metric === "distance_m" ? `${v} km` : m.fmt(Number(v)), m.label]}
            labelFormatter={(_, p) => (p?.[0]?.payload?.label as string) ?? ""}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.4} fill="url(#gForm)" />
        </AreaChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-xs text-mute">
        Average over {data.length} matches: <b className="text-slate-300">{m.fmt(avg)}</b>
      </p>
    </div>
  );
}

/** Distance benchmarks read in km; everything else in raw units. */
export function fmtBench(key: string, v: number): string {
  return key === "distance_per_match" ? `${(v / 1000).toFixed(1)} km` : `${v}`;
}

/** Percentile bars vs team-mates. 50 = team median-ish, 100 = team best. */
export function BenchmarkBars({ benchmarks, color = ACCENT }: { benchmarks: Benchmark[]; color?: string }) {
  if (benchmarks.length === 0)
    return (
      <p className="py-8 text-center text-sm text-mute">
        Benchmarks appear once at least two team-mates have match data.
      </p>
    );
  return (
    <div className="flex flex-col gap-3.5">
      {benchmarks.map((b) => (
        <div key={b.key}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-slate-300">{b.label}</span>
            <span className="tnum text-xs text-mute">
              <b className="text-white">{fmtBench(b.key, b.value)}</b> · team avg {fmtBench(b.key, b.team_avg)} · best {fmtBench(b.key, b.team_best)}
            </span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-line">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${b.percentile}%`, background: color }}
            />
          </div>
          <div className="mt-0.5 text-right text-[0.7rem] text-mute">
            <span className="font-semibold text-slate-300">{b.percentile}th</span> percentile in squad
          </div>
        </div>
      ))}
    </div>
  );
}
