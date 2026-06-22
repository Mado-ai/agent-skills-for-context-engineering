import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import FieldBreakdown from "../components/FieldBreakdown";
import type { PlayerProfile, TeamProfile } from "../types";

export default function PublicProfile({ kind }: { kind: "team" | "player" }) {
  const { token = "" } = useParams();
  const [data, setData] = useState<TeamProfile | PlayerProfile | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const p = kind === "team" ? api.publicTeam(token) : api.publicPlayer(token);
    p.then((d) => setData(d as TeamProfile | PlayerProfile)).catch(() => setError(true));
  }, [kind, token]);

  if (error) return <div className="p-10 text-center text-slate-400">This profile isn't available.</div>;
  if (!data) return <div className="p-10 text-center text-slate-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="mb-1 text-xs uppercase tracking-wide text-pitch">Public {kind} profile</p>
      {kind === "team" ? (
        <TeamView data={data as TeamProfile} />
      ) : (
        <PlayerView data={data as PlayerProfile} />
      )}
      <p className="mt-8 text-center text-xs text-slate-600">Shared via Play Metrics</p>
    </div>
  );
}

function TeamView({ data }: { data: TeamProfile }) {
  const r = data.record;
  return (
    <>
      <h1 className="text-2xl font-bold">{data.team.name}</h1>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Matches by field</h2>
          <FieldBreakdown data={data.matches_by_field} />
        </div>
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Record</h2>
          <p className="text-sm text-slate-300">
            {r.played} played · {r.wins}W {r.draws}D {r.losses}L · {r.goals_for}–{r.goals_against}
          </p>
          <p className="mt-2 text-sm text-slate-400">{data.player_count} players</p>
        </div>
      </div>
    </>
  );
}

function PlayerView({ data }: { data: PlayerProfile }) {
  const t = data.totals;
  return (
    <>
      <h1 className="text-2xl font-bold">
        {data.player.jersey != null && <span className="mr-2 text-slate-500">#{data.player.jersey}</span>}
        {data.player.name}
      </h1>
      {data.player.position && <p className="text-sm text-slate-400">{data.player.position}</p>}
      <div className="mt-5 rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 font-semibold">Matches by field</h2>
        <FieldBreakdown data={data.matches_by_field} />
      </div>
      <div className="mt-4 rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 font-semibold">Career totals</h2>
        <p className="text-sm text-slate-300">
          {t.matches} matches · {t.goals} goals · {t.assists} assists ·
          {" "}{(t.distance_m / 1000).toFixed(1)} km · top {t.top_speed_ms} m/s
        </p>
      </div>
    </>
  );
}
