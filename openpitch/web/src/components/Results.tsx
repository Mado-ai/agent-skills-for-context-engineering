import { api } from "../api/client";
import type { Job } from "../types";

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

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Player physical metrics">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1">#</th>
                <th>Team</th>
                <th>Dist (m)</th>
                <th>Top (m/s)</th>
              </tr>
            </thead>
            <tbody>
              {s.players.map((p) => (
                <tr key={p.player_id} className="border-b border-line">
                  <td className="py-1">{p.player_id}</td>
                  <td>{p.team}</td>
                  <td>{p.distance_m}</td>
                  <td>{p.top_speed_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

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
