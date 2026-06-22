import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { JobSummary } from "../types";

const HOME = "#dc3c3c";
const AWAY = "#3c5adc";
const GRID = "#232c38";
const tooltipStyle = {
  background: "#141a22",
  border: "1px solid #232c38",
  borderRadius: 8,
  fontSize: 12,
};

export function PossessionTimeline({ summary }: { summary: JobSummary }) {
  const data = summary.possession_timeline;
  const [home, away] = Object.keys(summary.possession);
  if (data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="t" stroke="#8b98a5" fontSize={11} unit="s" />
        <YAxis stroke="#8b98a5" fontSize={11} domain={[0, 100]} unit="%" />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="home" name={home} stroke={HOME} dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="away" name={away} stroke={AWAY} dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SpeedDistribution({ summary }: { summary: JobSummary }) {
  // Histogram of player top speeds in 2 m/s buckets up to 12 m/s.
  const bins = [0, 2, 4, 6, 8, 10, 12];
  const data = bins.slice(0, -1).map((lo, i) => {
    const hi = bins[i + 1];
    return {
      range: `${lo}–${hi}`,
      count: summary.players.filter((p) => p.top_speed_ms >= lo && p.top_speed_ms < hi).length,
    };
  });
  if (summary.players.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -22 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="range" stroke="#8b98a5" fontSize={11} unit=" m/s" />
        <YAxis stroke="#8b98a5" fontSize={11} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
        <Bar dataKey="count" name="players" fill="#2ecc71" radius={[4, 4, 0, 0]} />
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
    .map((p) => ({ name: `#${p.player_id}`, distance: p.distance_m, team: p.team }));
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="name" stroke="#8b98a5" fontSize={11} />
        <YAxis stroke="#8b98a5" fontSize={11} unit="m" />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
        <Bar dataKey="distance" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.team === home ? HOME : AWAY} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
