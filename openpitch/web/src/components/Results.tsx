import { api } from "../api/client";
import type { Job } from "../types";
import { DistanceChart, PossessionTimeline, SpeedDistribution } from "./Charts";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </div>
  );
}

export default function Results({ job }: { job: Job | null }) {
  if (!job || !job.summary) {
    return (
      <Card title="Results">
        <p className="text-sm text-slate-400">
          Run the demo clip or upload a match, then select a job to see the broadcast and analytics here.
        </p>
      </Card>
    );
  }

  const s = job.summary;
  const teams = Object.keys(s.possession);
  const [home, away] = teams;
  const homePct = s.possession[home] ?? 0;
  const awayPct = s.possession[away] ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Auto-produced broadcast">
        <p className="mb-2 text-xs text-slate-400">Virtual cameraman — no operator.</p>
        <video
          key={job.id}
          src={api.fileUrl(job.id, "broadcast.mp4")}
          controls
          className="w-full rounded-lg bg-black"
        />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Possession">
          <div className="flex h-7 overflow-hidden rounded">
            <div className="bg-home" style={{ width: `${homePct}%` }} />
            <div className="bg-away" style={{ width: `${awayPct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span>
              <b>{home}</b> {homePct}%
            </span>
            <span>
              {awayPct}% <b>{away}</b>
            </span>
          </div>
        </Card>

        <Card title="Match info">
          <ul className="text-sm">
            {Object.entries(s.meta).map(([k, v]) => (
              <li key={k} className="flex justify-between border-b border-line py-1">
                <span className="text-slate-400">{k}</span>
                <b>{String(v)}</b>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Possession over time">
          <PossessionTimeline summary={s} />
        </Card>
        <Card title="Distance covered (top 8)">
          <DistanceChart summary={s} />
        </Card>
        <Card title="Top-speed distribution">
          <SpeedDistribution summary={s} />
        </Card>
      </div>

      <Card title="Positional heatmaps">
        <div className="flex gap-4">
          {teams.map((t) => (
            <figure key={t} className="flex-1 text-center text-xs text-slate-400">
              <img src={api.fileUrl(job.id, s.heatmaps[t])} alt={`${t} heatmap`} className="w-full rounded-lg" />
              <figcaption className="mt-1">{t}</figcaption>
            </figure>
          ))}
        </div>
      </Card>

      {s.team_stats && (
        <Card title="Team comparison">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1">Metric</th>
                {teams.map((t) => <th key={t} className="text-right">{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                ["Possession", (t: string) => `${s.possession[t]}%`],
                ["Distance", (t: string) => `${s.team_stats![t]?.distance_km} km`],
                ["Sprints", (t: string) => s.team_stats![t]?.sprints],
                ["Passes", (t: string) => s.team_stats![t]?.passes],
                ["Pass acc.", (t: string) => s.team_stats![t]?.pass_accuracy != null ? `${s.team_stats![t]!.pass_accuracy}%` : "—"],
                ["Turnovers", (t: string) => s.team_stats![t]?.turnovers],
                ["Progressive", (t: string) => s.team_stats![t]?.progressive_passes ?? "—"],
                ["Final-third", (t: string) => s.team_stats![t]?.final_third_passes ?? "—"],
                ["xT added", (t: string) => s.team_stats![t]?.xt_added ?? "—"],
                ["Shots", (t: string) => s.team_stats![t]?.shots ?? "—"],
                ["xG", (t: string) => s.team_stats![t]?.xg ?? "—"],
                ["Top speed", (t: string) => `${s.team_stats![t]?.top_speed_ms} m/s`],
              ] as const).map(([label, fn]) => (
                <tr key={label} className="border-b border-line">
                  <td className="py-1 text-slate-400">{label}</td>
                  {teams.map((t) => <td key={t} className="text-right font-medium">{fn(t)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Player metrics">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1">#</th>
                <th>Team</th>
                <th>Dist (km)</th>
                <th>Top</th>
                <th>Avg</th>
                <th>Sprints</th>
                <th>Touches</th>
                <th>Passes</th>
                <th>Acc.</th>
                <th>Prog.</th>
                <th>xT</th>
                <th>Shots</th>
                <th>xG</th>
              </tr>
            </thead>
            <tbody>
              {s.players.map((p) => (
                <tr key={String(p.player_id)} className="border-b border-line">
                  <td className="py-1">{p.jersey ?? p.player_id}</td>
                  <td>{p.team}</td>
                  <td>{(p.distance_m / 1000).toFixed(2)}</td>
                  <td>{p.top_speed_ms}</td>
                  <td>{p.avg_speed_ms ?? "—"}</td>
                  <td>{p.sprints ?? "—"}</td>
                  <td>{p.touches ?? "—"}</td>
                  <td>{p.passes ?? "—"}</td>
                  <td>{p.pass_accuracy != null ? `${p.pass_accuracy}%` : "—"}</td>
                  <td>{p.progressive_passes ?? "—"}</td>
                  <td>{p.xt_added != null ? p.xt_added.toFixed(2) : "—"}</td>
                  <td>{p.shots ?? "—"}</td>
                  <td>{p.xg != null ? p.xg.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-1">
        <Card title="Auto highlights">
          {s.highlights.length === 0 ? (
            <p className="text-sm text-slate-400">No highlights detected.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {s.highlights.map((h, i) => (
                <div key={i}>
                  <p className="text-xs text-slate-400">
                    #{i + 1} · {h.start_s}s–{h.end_s}s · intensity {h.peak_speed}
                  </p>
                  {h.clip && (
                    <video src={api.fileUrl(job.id, `highlights/${h.clip}`)} controls className="mt-1 w-full rounded-lg bg-black" />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
