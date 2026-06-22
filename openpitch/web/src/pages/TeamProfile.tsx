import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import FieldBreakdown from "../components/FieldBreakdown";
import MatchStatsImport from "../components/MatchStatsImport";
import type { TeamProfile as TP } from "../types";

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function TeamProfile() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [tp, setTp] = useState<TP | null>(null);
  const [pName, setPName] = useState("");
  const [pPos, setPPos] = useState("");
  const [pNum, setPNum] = useState("");
  const [mField, setMField] = useState("11");
  const [mOpp, setMOpp] = useState("");
  const [mHome, setMHome] = useState("");
  const [mAway, setMAway] = useState("");
  const [pMinor, setPMinor] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);

  const load = useCallback(() => api.getTeam(id).then(setTp).catch(() => setTp(null)), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!tp) return <div className="p-10 text-center text-slate-400">Loading…</div>;
  const r = tp.record;

  const addPlayer = async () => {
    if (!pName.trim()) return;
    await api.createPlayer(id, {
      name: pName, position: pPos, is_minor: String(pMinor),
      ...(pNum ? { jersey: pNum } : {}),
    });
    setPName(""); setPPos(""); setPNum("");
    load();
  };
  const addMatch = async () => {
    await api.createMatch(id, {
      field_type: mField, opponent: mOpp,
      ...(mHome ? { home_score: mHome } : {}), ...(mAway ? { away_score: mAway } : {}),
    });
    setMOpp(""); setMHome(""); setMAway("");
    load();
  };
  const share = async () => {
    const res = await api.shareTeam(id);
    if (res.public && res.public_token) {
      const url = `${location.origin}/share/team/${res.public_token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      alert(`Public link copied:\n${url}`);
    } else {
      alert("Sharing turned off.");
    }
    load();
  };
  const exportTeam = async () => {
    const bundle = await api.exportTeam(id);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tp.team.name.replace(/\s+/g, "-")}.json`;
    a.click();
  };
  const remove = async () => {
    if (confirm(`Delete team "${tp.team.name}" and all its data?`)) {
      await api.deleteTeam(id);
      navigate("/teams");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/teams" className="text-sm text-slate-400 hover:text-white">← Teams</Link>
          <h1 className="text-2xl font-bold">{tp.team.name}</h1>
        </div>
        <div className="flex gap-2 text-sm">
          <button onClick={share} className="rounded-lg bg-line px-3 py-2 font-semibold">
            {tp.team.public_token ? "Unshare" : "Share"}
          </button>
          <button onClick={exportTeam} className="rounded-lg bg-line px-3 py-2 font-semibold">Export</button>
          <button onClick={remove} className="rounded-lg bg-line px-3 py-2 font-semibold text-red-400">Delete</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Matches by field">
          <FieldBreakdown data={tp.matches_by_field} />
        </Card>
        <Card title="Record">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["W", r.wins], ["D", r.draws], ["L", r.losses]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-ink p-3">
                <div className="text-2xl font-bold">{v}</div>
                <div className="text-xs text-slate-400">{k}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-sm text-slate-400">
            {r.played} played · {r.goals_for}–{r.goals_against} goals
          </p>
        </Card>
        <Card title="Distance leaders">
          {tp.leaderboard.length === 0 ? (
            <p className="text-sm text-slate-400">No player stats yet.</p>
          ) : (
            <ul className="text-sm">
              {tp.leaderboard.slice(0, 5).map((l) => (
                <li key={l.player_id} className="flex justify-between border-b border-line py-1">
                  <span>{l.name}</span>
                  <b>{(l.distance_m / 1000).toFixed(1)} km</b>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title={`Roster (${tp.player_count})`}>
          <ul className="mb-3 flex flex-col gap-1">
            {tp.players.map((p) => (
              <li key={p.id}>
                <Link to={`/players/${p.id}`} className="flex justify-between rounded px-2 py-1.5 text-sm hover:bg-ink">
                  <span>{p.jersey != null && <b className="mr-2 text-slate-500">#{p.jersey}</b>}{p.name}</span>
                  <span className="text-slate-500">{p.position}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Player name"
              className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
            <input value={pPos} onChange={(e) => setPPos(e.target.value)} placeholder="Pos"
              className="w-16 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
            <input value={pNum} onChange={(e) => setPNum(e.target.value)} placeholder="#" inputMode="numeric"
              className="w-14 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={pMinor} onChange={(e) => setPMinor(e.target.checked)} />
              minor
            </label>
            <button onClick={addPlayer} className="rounded bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950">Add</button>
          </div>
        </Card>

        <Card title="Matches">
          <ul className="mb-3 flex flex-col gap-1">
            {tp.recent_matches.map((m) => (
              <li key={m.id} className="rounded px-2 py-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span><b className="mr-2 text-slate-500">{m.field_type}v{m.field_type}</b>{m.opponent || "—"}</span>
                  <span className="flex items-center gap-2 text-slate-400">
                    {m.home_score != null ? `${m.home_score}–${m.away_score}` : ""} {m.played_on || ""}
                    {m.job_id && (
                      <button
                        onClick={() => setImporting(importing === m.id ? null : m.id)}
                        className="rounded bg-line px-2 py-0.5 text-xs text-pitch"
                        title="Import player stats from the linked analysis"
                      >
                        ↳ analysis
                      </button>
                    )}
                  </span>
                </div>
                {importing === m.id && (
                  <MatchStatsImport
                    matchId={m.id}
                    onDone={() => {
                      setImporting(null);
                      load();
                    }}
                  />
                )}
              </li>
            ))}
            {tp.recent_matches.length === 0 && <li className="text-sm text-slate-400">No matches yet.</li>}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <select value={mField} onChange={(e) => setMField(e.target.value)}
              className="rounded border border-line bg-ink px-2 py-1.5 text-sm">
              <option value="5">5-a-side</option>
              <option value="7">7-a-side</option>
              <option value="11">11-a-side</option>
            </select>
            <input value={mOpp} onChange={(e) => setMOpp(e.target.value)} placeholder="Opponent"
              className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
            <input value={mHome} onChange={(e) => setMHome(e.target.value)} placeholder="GF" inputMode="numeric"
              className="w-12 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
            <input value={mAway} onChange={(e) => setMAway(e.target.value)} placeholder="GA" inputMode="numeric"
              className="w-12 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
            <button onClick={addMatch} className="rounded bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950">Add</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
