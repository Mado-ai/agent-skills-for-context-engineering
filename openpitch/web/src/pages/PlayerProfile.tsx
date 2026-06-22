import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import FieldBreakdown from "../components/FieldBreakdown";
import type { PlayerProfile as PP } from "../types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-ink p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

export default function PlayerProfile() {
  const { id = "" } = useParams();
  const [pp, setPp] = useState<PP | null>(null);

  const load = useCallback(() => api.getPlayer(id).then(setPp).catch(() => setPp(null)), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!pp) return <div className="p-10 text-center text-slate-400">Loading…</div>;
  const t = pp.totals;

  const share = async () => {
    const res = await api.sharePlayer(id);
    if (res.public && res.public_token) {
      const url = `${location.origin}/share/player/${res.public_token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      alert(`Public profile link copied:\n${url}`);
    } else {
      alert("Sharing turned off.");
    }
    load();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/teams/${pp.team_id}`} className="text-sm text-slate-400 hover:text-white">← Team</Link>
          <h1 className="text-2xl font-bold">
            {pp.player.jersey != null && <span className="mr-2 text-slate-500">#{pp.player.jersey}</span>}
            {pp.player.name}
          </h1>
          {pp.player.position && <p className="text-sm text-slate-400">{pp.player.position}</p>}
        </div>
        <button onClick={share} className="rounded-lg bg-line px-3 py-2 text-sm font-semibold">
          {pp.public_token ? "Unshare" : "Share profile"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Matches by field</h2>
          <FieldBreakdown data={pp.matches_by_field} />
        </div>
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Career totals</h2>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Matches" value={t.matches} />
            <Stat label="Goals" value={t.goals} />
            <Stat label="Assists" value={t.assists} />
            <Stat label="Distance" value={`${(t.distance_m / 1000).toFixed(1)} km`} />
            <Stat label="Avg/match" value={`${(t.avg_distance_m / 1000).toFixed(1)} km`} />
            <Stat label="Top speed" value={`${t.top_speed_ms} m/s`} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 font-semibold">Recent matches</h2>
        {pp.recent.length === 0 ? (
          <p className="text-sm text-slate-400">No match stats recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1">Field</th><th>Opponent</th><th>Date</th>
                <th>Dist</th><th>Top</th><th>G</th><th>A</th>
              </tr>
            </thead>
            <tbody>
              {pp.recent.map((m) => (
                <tr key={m.match_id} className="border-b border-line">
                  <td className="py-1">{m.field_type}v{m.field_type}</td>
                  <td>{m.opponent || "—"}</td>
                  <td>{m.played_on || "—"}</td>
                  <td>{((m.distance_m || 0) / 1000).toFixed(1)} km</td>
                  <td>{m.top_speed_ms || 0}</td>
                  <td>{m.goals || 0}</td>
                  <td>{m.assists || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
