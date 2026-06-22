import { useMemo, useState } from "react";
import { api } from "../api/client";
import type { Job, PlayerStat } from "../types";
import { DistanceChart, PossessionTimeline, SpeedDistribution, TouchLeaders, XtLeaders } from "./Charts";
import { cx } from "../lib/cx";
import { Avatar, Badge, Card, CellBar, Donut, Icon, StatCard, Tabs, TeamChip, VersusRow } from "./ui";

const HOME = "#ff5a5a";
const AWAY = "#4d7cff";

type TabId = "overview" | "players" | "highlights";

export default function Results({ job }: { job: Job | null }) {
  const [tab, setTab] = useState<TabId>("overview");

  if (!job || !job.summary) {
    return (
      <Card className="grid min-h-[420px] place-items-center" pad>
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-pitch/10 text-pitch">
            <Icon name="chart" width={26} height={26} />
          </div>
          <h2 className="text-lg font-semibold">Your match report appears here</h2>
          <p className="mt-1.5 text-sm text-mute">
            Run the demo clip or upload a match on the left. You'll get the auto-produced
            broadcast, possession, heatmaps and full player analytics — distance, speed,
            passing, expected threat and xG.
          </p>
        </div>
      </Card>
    );
  }

  const s = job.summary;
  const teams = Object.keys(s.possession);
  const [home, away] = teams;
  const homePct = s.possession[home] ?? 0;
  const awayPct = s.possession[away] ?? 0;
  const ts = s.team_stats;
  const color = (t: string) => (t === home ? HOME : AWAY);
  const hasXt = s.players.some((p) => (p.xt_added ?? 0) !== 0);

  return (
    <div className="flex flex-col gap-5 fade-up">
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight">{job.input_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge color="green">{job.detector}</Badge>
            {String(s.meta?.calibration ?? "") && (
              <Badge color={s.meta.calibration === "homography" ? "blue" : "slate"}>
                {s.meta.calibration === "homography" ? "calibrated" : "proxy"} pitch
              </Badge>
            )}
            {Object.entries(s.meta)
              .filter(([k]) => k !== "calibration")
              .slice(0, 3)
              .map(([k, v]) => (
                <span key={k} className="text-xs text-mute">
                  · {k}: <b className="text-slate-300">{String(v)}</b>
                </span>
              ))}
          </div>
        </div>
        <Tabs<TabId>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "overview", label: "Overview", icon: "activity" },
            { id: "players", label: "Players", icon: "users" },
            { id: "highlights", label: "Highlights", icon: "film" },
          ]}
        />
      </div>

      {/* ---- KPI strip (always visible) ---- */}
      <KpiStrip s={s} />

      {tab === "overview" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <Card title="Auto-produced broadcast" subtitle="Virtual cameraman — no operator" icon="film" pad={false}>
              {s.broadcast === false ? (
                <div className="grid aspect-video place-items-center rounded-b-2xl bg-gradient-to-br from-ink-2 to-ink text-center">
                  <div>
                    <span className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-2xl bg-pitch/10 text-pitch">
                      <Icon name="activity" width={22} height={22} />
                    </span>
                    <p className="text-sm font-medium text-slate-300">Tracking-data analysis</p>
                    <p className="mx-auto mt-1 max-w-xs text-xs text-mute">
                      This report is built from ground-truth player tracking — no broadcast
                      feed. Upload match video to generate the auto-produced broadcast.
                    </p>
                  </div>
                </div>
              ) : (
                <video
                  key={job.id}
                  src={api.fileUrl(job.id, "broadcast.mp4")}
                  controls
                  className="aspect-video w-full rounded-b-2xl bg-black"
                />
              )}
            </Card>

            <Card title="Possession" icon="target">
              <div className="flex items-center justify-around">
                <Donut
                  a={homePct}
                  b={awayPct}
                  colorA={HOME}
                  colorB={AWAY}
                  center={
                    <div className="text-center">
                      <div className="tnum text-xl font-bold" style={{ color: HOME }}>
                        {homePct}%
                      </div>
                      <div className="text-[0.65rem] text-mute">vs {awayPct}%</div>
                    </div>
                  }
                />
                <div className="flex flex-col gap-3 text-sm">
                  <Legend color={HOME} name={home} pct={homePct} />
                  <Legend color={AWAY} name={away} pct={awayPct} />
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Card title="Possession over time" icon="activity">
              <PossessionTimeline summary={s} />
            </Card>
            {hasXt ? (
              <Card title="Expected threat — top creators" subtitle="xT added by progressive passing" icon="route">
                <XtLeaders summary={s} />
              </Card>
            ) : (
              <Card title="Most involved players" subtitle="On-ball touches (xT shows on match footage)" icon="route">
                <TouchLeaders summary={s} />
              </Card>
            )}
            <Card title="Distance covered" subtitle="Top 8 players" icon="gauge">
              <DistanceChart summary={s} />
            </Card>
            <Card title="Top-speed distribution" icon="zap">
              <SpeedDistribution summary={s} />
            </Card>
          </div>

          {ts && (
            <Card title="Team comparison" icon="shield">
              <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                <TeamChip name={home} color={HOME} />
                <TeamChip name={away} color={AWAY} />
              </div>
              <div className="divide-y divide-line/60">
                <VersusRow label="Possession" a={homePct} b={awayPct} colorA={HOME} colorB={AWAY} fmt={(n) => `${n}%`} />
                <VersusRow label="Distance" a={ts[home]?.distance_km ?? 0} b={ts[away]?.distance_km ?? 0} colorA={HOME} colorB={AWAY} fmt={(n) => `${n}km`} />
                <VersusRow label="Sprints" a={ts[home]?.sprints ?? 0} b={ts[away]?.sprints ?? 0} colorA={HOME} colorB={AWAY} />
                <VersusRow label="Passes" a={ts[home]?.passes ?? 0} b={ts[away]?.passes ?? 0} colorA={HOME} colorB={AWAY} />
                <VersusRow label="Pass acc." a={ts[home]?.pass_accuracy ?? 0} b={ts[away]?.pass_accuracy ?? 0} colorA={HOME} colorB={AWAY} fmt={(n) => `${n}%`} />
                <VersusRow label="Progressive" a={ts[home]?.progressive_passes ?? 0} b={ts[away]?.progressive_passes ?? 0} colorA={HOME} colorB={AWAY} />
                <VersusRow label="xT added" a={ts[home]?.xt_added ?? 0} b={ts[away]?.xt_added ?? 0} colorA={HOME} colorB={AWAY} fmt={(n) => n.toFixed(2)} />
                <VersusRow label="Shots" a={ts[home]?.shots ?? 0} b={ts[away]?.shots ?? 0} colorA={HOME} colorB={AWAY} />
                <VersusRow label="xG" a={ts[home]?.xg ?? 0} b={ts[away]?.xg ?? 0} colorA={HOME} colorB={AWAY} fmt={(n) => n.toFixed(2)} />
              </div>
            </Card>
          )}

          <Card title="Positional heatmaps" icon="flame">
            <div className="grid gap-4 sm:grid-cols-2">
              {teams.map((t) => (
                <figure key={t} className="overflow-hidden rounded-xl border border-line">
                  <img src={api.fileUrl(job.id, s.heatmaps[t])} alt={`${t} heatmap`} className="w-full" />
                  <figcaption className="flex items-center gap-2 border-t border-line bg-ink-2 px-3 py-2 text-xs">
                    <TeamChip name={t} color={color(t)} />
                  </figcaption>
                </figure>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "players" && <PlayersTab s={s} color={color} />}

      {tab === "highlights" && (
        <Card title="Auto highlights" subtitle="Detected high-intensity moments" icon="film">
          {s.highlights.length === 0 ? (
            <p className="text-sm text-mute">No highlights detected in this clip.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {s.highlights.map((h, i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-line bg-ink-2">
                  {h.clip ? (
                    <video src={api.fileUrl(job.id, `highlights/${h.clip}`)} controls className="aspect-video w-full bg-black" />
                  ) : (
                    <div className="grid aspect-video place-items-center bg-black text-mute">
                      <Icon name="play" width={28} height={28} />
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="font-medium">Highlight #{i + 1}</span>
                    <span className="text-mute">
                      {h.start_s}s–{h.end_s}s · intensity {h.peak_speed}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Legend({ color, name, pct }: { color: string; name: string; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="tnum text-xs text-mute">{pct}%</span>
      </span>
    </div>
  );
}

function KpiStrip({ s }: { s: NonNullable<Job["summary"]> }) {
  const totalDist = s.players.reduce((a, p) => a + p.distance_m, 0) / 1000;
  const topSpeed = s.players.reduce((a, p) => Math.max(a, p.top_speed_ms), 0);
  const passes = s.players.reduce((a, p) => a + (p.passes ?? 0), 0);
  const shots = s.players.reduce((a, p) => a + (p.shots ?? 0), 0);
  const xg = s.players.reduce((a, p) => a + (p.xg ?? 0), 0);
  const sprints = s.players.reduce((a, p) => a + (p.sprints ?? 0), 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Total distance" value={totalDist.toFixed(1)} unit="km" icon="gauge" accent="pitch" />
      <StatCard label="Top speed" value={topSpeed.toFixed(1)} unit="m/s" icon="zap" accent="amber" />
      <StatCard label="Sprints" value={sprints} icon="activity" accent="violet" />
      <StatCard label="Passes" value={passes} icon="route" accent="away" />
      <StatCard label="Shots" value={shots} icon="crosshair" accent="home" />
      <StatCard label="Expected goals" value={xg.toFixed(2)} unit="xG" icon="target" accent="pitch" />
    </div>
  );
}

/* ------------------------------------------------------------- players -- */

type SortKey =
  | "distance_m" | "top_speed_ms" | "avg_speed_ms" | "sprints"
  | "passes" | "pass_accuracy" | "progressive_passes" | "xt_added" | "shots" | "xg";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "distance_m", label: "Dist (km)" },
  { key: "top_speed_ms", label: "Top" },
  { key: "avg_speed_ms", label: "Avg" },
  { key: "sprints", label: "Sprints" },
  { key: "passes", label: "Passes" },
  { key: "pass_accuracy", label: "Acc." },
  { key: "progressive_passes", label: "Prog." },
  { key: "xt_added", label: "xT" },
  { key: "shots", label: "Shots" },
  { key: "xg", label: "xG" },
];

function num(p: PlayerStat, k: SortKey): number {
  return Number(p[k] ?? 0);
}

function PlayersTab({ s, color }: { s: NonNullable<Job["summary"]>; color: (t: string) => string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "distance_m", dir: -1 });
  const maxDist = useMemo(() => Math.max(...s.players.map((p) => p.distance_m), 1), [s.players]);

  const rows = useMemo(
    () => [...s.players].sort((a, b) => (num(a, sort.key) - num(b, sort.key)) * sort.dir),
    [s.players, sort],
  );
  const top = useMemo(() => [...s.players].sort((a, b) => b.distance_m - a.distance_m).slice(0, 3), [s.players]);

  const onSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: (cur.dir * -1) as 1 | -1 } : { key, dir: -1 }));

  const fmt = (p: PlayerStat, k: SortKey): string => {
    const v = num(p, k);
    if (k === "distance_m") return (v / 1000).toFixed(2);
    if (k === "pass_accuracy") return p.pass_accuracy != null ? `${v}%` : "—";
    if (k === "xt_added" || k === "xg") return v.toFixed(2);
    return String(v);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {top.map((p, i) => (
          <div key={String(p.player_id)} className="lift flex items-center gap-3 rounded-2xl border border-line bg-card p-4 shadow-card hover:border-line-2">
            <Avatar label={String(p.jersey ?? "?")} color={color(p.team)} size={42} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold">{p.player_id}</span>
                {i === 0 && <Icon name="trophy" width={15} height={15} className="text-amber" />}
              </div>
              <p className="tnum text-xs text-mute">
                {(p.distance_m / 1000).toFixed(2)} km · {p.top_speed_ms} m/s · {p.passes ?? 0} passes
              </p>
            </div>
          </div>
        ))}
      </div>

      <Card title="Player metrics" subtitle={`${s.players.length} players · click a column to sort`} icon="users" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-mute">
                <th className="py-2.5 pl-5 font-medium">Player</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-2.5 text-right font-medium">
                    <button onClick={() => onSort(c.key)} className={cx("inline-flex items-center gap-1 hover:text-white", sort.key === c.key && "text-pitch")}>
                      {c.label}
                      {sort.key === c.key && <span className="text-[0.6rem]">{sort.dir === -1 ? "▼" : "▲"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={String(p.player_id)} className="border-b border-line/50 transition hover:bg-white/[0.02]">
                  <td className="py-2 pl-5">
                    <div className="flex items-center gap-2.5">
                      <Avatar label={String(p.jersey ?? "?")} color={color(p.team)} size={30} />
                      <div className="min-w-0">
                        <span className="block truncate font-medium">{p.player_id}</span>
                        <span className="text-xs text-mute">{p.team}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tnum w-10 text-right">{(p.distance_m / 1000).toFixed(2)}</span>
                      <span className="hidden w-16 sm:block">
                        <CellBar value={p.distance_m} max={maxDist} color={color(p.team)} />
                      </span>
                    </div>
                  </td>
                  {COLUMNS.slice(1).map((c) => (
                    <td key={c.key} className="tnum px-2 py-2 text-right">
                      {fmt(p, c.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
