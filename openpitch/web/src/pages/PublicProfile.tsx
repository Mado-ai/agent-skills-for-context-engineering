import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import FieldBreakdown from "../components/FieldBreakdown";
import { Avatar, Badge, Card, CellBar, StatCard } from "../components/ui";
import { brandColor, initials } from "../lib/brand";
import type { PlayerProfile, TeamProfile } from "../types";

export default function PublicProfile({ kind }: { kind: "team" | "player" }) {
  const { token = "" } = useParams();
  const [data, setData] = useState<TeamProfile | PlayerProfile | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const p = kind === "team" ? api.publicTeam(token) : api.publicPlayer(token);
    p.then((d) => setData(d as TeamProfile | PlayerProfile)).catch(() => setError(true));
  }, [kind, token]);

  if (error) return <div className="p-10 text-center text-mute">This profile isn't available.</div>;
  if (!data) return <div className="p-10 text-center text-mute">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-pitch">Public {kind} profile</p>
      {kind === "team" ? <TeamView data={data as TeamProfile} /> : <PlayerView data={data as PlayerProfile} />}
      <p className="mt-10 text-center text-xs text-mute">⚽ Shared via Play Metrics</p>
    </div>
  );
}

function Header({ brand, label, title, subtitle, badge }: {
  brand: string; label: string; title: string; subtitle: string; badge?: string;
}) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(600px 220px at 0% 0%, ${brand}, transparent 70%)` }} />
      <div className="relative flex items-center gap-4 p-5">
        <Avatar label={label} color={brand} size={60} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-mute">
            <span>{subtitle}</span>
            {badge && <Badge color="green">{badge}</Badge>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamView({ data }: { data: TeamProfile }) {
  const r = data.record;
  const brand = brandColor(data.team.id);
  const maxDist = Math.max(...data.leaderboard.map((l) => l.distance_m), 1);
  return (
    <>
      <Header brand={brand} label={initials(data.team.name)} title={data.team.name}
        subtitle={`${data.player_count} players · ${r.played} matches`} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Played" value={r.played} icon="shield" accent="violet" />
        <StatCard label="Wins" value={r.wins} icon="trophy" accent="pitch" />
        <StatCard label="Draws" value={r.draws} icon="activity" accent="amber" />
        <StatCard label="Losses" value={r.losses} icon="activity" accent="home" />
        <StatCard label="Goals for" value={r.goals_for} icon="target" accent="pitch" />
        <StatCard label="Goals against" value={r.goals_against} icon="crosshair" accent="away" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Matches by field" icon="chart">
          <FieldBreakdown data={data.matches_by_field} />
        </Card>
        <Card title="Distance leaders" icon="gauge">
          {data.leaderboard.length === 0 ? (
            <p className="text-sm text-mute">No player stats yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {data.leaderboard.slice(0, 5).map((l) => (
                <li key={l.player_id} className="flex items-center gap-3">
                  <Avatar label={initials(l.name)} color={brand} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{l.name}</span>
                      <b className="tnum">{(l.distance_m / 1000).toFixed(1)} km</b>
                    </div>
                    <div className="mt-1"><CellBar value={l.distance_m} max={maxDist} color={brand} /></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function PlayerView({ data }: { data: PlayerProfile }) {
  const t = data.totals;
  const brand = brandColor(data.team_id);
  const label = data.player.jersey != null ? String(data.player.jersey) : initials(data.player.name);
  const sub = [data.player.jersey != null ? `#${data.player.jersey}` : null, data.player.position]
    .filter(Boolean).join(" · ") || "Player";
  return (
    <>
      <Header brand={brand} label={label} title={data.player.name} subtitle={sub} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Matches" value={t.matches} icon="shield" accent="violet" />
        <StatCard label="Goals" value={t.goals} icon="target" accent="pitch" />
        <StatCard label="Assists" value={t.assists} icon="route" accent="away" />
        <StatCard label="Distance" value={(t.distance_m / 1000).toFixed(1)} unit="km" icon="gauge" accent="pitch" />
        <StatCard label="Sprints" value={t.sprints} icon="zap" accent="amber" />
        <StatCard label="Top speed" value={t.top_speed_ms} unit="m/s" icon="activity" accent="home" />
      </div>

      <Card title="Matches by field" icon="chart">
        <FieldBreakdown data={data.matches_by_field} />
      </Card>
    </>
  );
}
