import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import FieldBreakdown from "../components/FieldBreakdown";
import { Avatar, Badge, Card, Icon, StatCard } from "../components/ui";
import { brandColor, initials } from "../lib/brand";
import type { PlayerProfile as PP } from "../types";

export default function PlayerProfile() {
  const { id = "" } = useParams();
  const [pp, setPp] = useState<PP | null>(null);

  const load = useCallback(() => api.getPlayer(id).then(setPp).catch(() => setPp(null)), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!pp) return <div className="p-10 text-center text-mute">Loading…</div>;
  const t = pp.totals;
  const brand = brandColor(pp.team_id);
  const label = pp.player.jersey != null ? String(pp.player.jersey) : initials(pp.player.name);

  const share = async () => {
    try {
      const res = await api.sharePlayer(id);
      if (res.public && res.public_token) {
        const url = `${location.origin}/share/player/${res.public_token}`;
        await navigator.clipboard?.writeText(url).catch(() => {});
        alert(`Public profile link copied:\n${url}`);
      } else {
        alert("Sharing turned off.");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not share");
    }
    load();
  };

  const toggleConsent = async () => {
    await api.grantConsent(id, !pp.guardian_consent);
    load();
  };

  const btn = "rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold transition hover:border-line-2";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link to={`/teams/${pp.team_id}`} className="text-sm text-mute hover:text-white">← Team</Link>

      {/* branded header */}
      <div className="relative mt-2 mb-6 overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(600px 220px at 100% 0%, ${brand}, transparent 70%)` }} />
        <div className="relative flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <Avatar label={label} color={brand} size={60} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{pp.player.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-mute">
                {pp.player.jersey != null && <span>#{pp.player.jersey}</span>}
                {pp.player.position && <span>· {pp.player.position}</span>}
                {pp.is_minor && (
                  <Badge color={pp.guardian_consent ? "green" : "amber"}>
                    {pp.guardian_consent ? "consent given" : "minor — consent required"}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pp.is_minor && (
              <button onClick={toggleConsent} className={`${btn} ${pp.guardian_consent ? "text-pitch" : "text-amber"}`}
                title="Guardian consent is required before a minor's profile can be shared">
                {pp.guardian_consent ? "✓ Consent" : "Grant consent"}
              </button>
            )}
            <button onClick={share} className={btn}>{pp.public_token ? "Unshare" : "Share profile"}</button>
          </div>
        </div>
      </div>

      {pp.is_minor && !pp.guardian_consent && (
        <p className="-mt-3 mb-4 flex items-center gap-1.5 text-xs text-amber">
          <Icon name="shield" width={14} height={14} />
          Minor profile — guardian consent required before sharing publicly.
        </p>
      )}

      {/* career KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Matches" value={t.matches} icon="shield" accent="violet" />
        <StatCard label="Goals" value={t.goals} icon="target" accent="pitch" />
        <StatCard label="Assists" value={t.assists} icon="route" accent="away" />
        <StatCard label="Distance" value={(t.distance_m / 1000).toFixed(1)} unit="km" icon="gauge" accent="pitch" />
        <StatCard label="Sprints" value={t.sprints} icon="zap" accent="amber" />
        <StatCard label="Top speed" value={t.top_speed_ms} unit="m/s" icon="activity" accent="home" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Matches by field" icon="chart">
          <FieldBreakdown data={pp.matches_by_field} />
        </Card>
        <Card title="Per-match averages" icon="gauge">
          <div className="grid grid-cols-2 gap-3">
            <Mini label="Avg distance" value={`${(t.avg_distance_m / 1000).toFixed(1)} km`} />
            <Mini label="Passes" value={t.passes} />
            <Mini label="Minutes" value={t.minutes} />
            <Mini label="Top speed" value={`${t.top_speed_ms} m/s`} />
          </div>
        </Card>
      </div>

      <Card title="Recent matches" icon="film" className="mt-4">
        {pp.recent.length === 0 ? (
          <p className="text-sm text-mute">No match stats recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-mute">
                  <th className="py-2 font-medium">Field</th>
                  <th className="font-medium">Opponent</th>
                  <th className="font-medium">Date</th>
                  <th className="text-right font-medium">Dist</th>
                  <th className="text-right font-medium">Top</th>
                  <th className="text-right font-medium">Spr</th>
                  <th className="text-right font-medium">Pass</th>
                  <th className="text-right font-medium">G</th>
                  <th className="text-right font-medium">A</th>
                </tr>
              </thead>
              <tbody>
                {pp.recent.map((m) => (
                  <tr key={m.match_id} className="border-b border-line/50">
                    <td className="py-2">{m.field_type}v{m.field_type}</td>
                    <td>{m.opponent || "—"}</td>
                    <td className="text-mute">{m.played_on || "—"}</td>
                    <td className="tnum text-right">{((m.distance_m || 0) / 1000).toFixed(1)} km</td>
                    <td className="tnum text-right">{m.top_speed_ms || 0}</td>
                    <td className="tnum text-right">{m.sprints ?? 0}</td>
                    <td className="tnum text-right">{m.passes ?? 0}</td>
                    <td className="tnum text-right">{m.goals || 0}</td>
                    <td className="tnum text-right">{m.assists || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-ink-2 p-3 text-center">
      <div className="tnum text-lg font-bold">{value}</div>
      <div className="text-xs text-mute">{label}</div>
    </div>
  );
}
