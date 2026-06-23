import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import FieldBreakdown from "../components/FieldBreakdown";
import HeadToHead from "../components/HeadToHead";
import MatchStatsEditor from "../components/MatchStatsEditor";
import MatchStatsImport from "../components/MatchStatsImport";
import { Avatar, Badge, Card, CellBar, StatCard } from "../components/ui";
import { brandColor, initials } from "../lib/brand";
import type { TeamProfile as TP } from "../types";

const H2H_COLOR_A = "#2ee27a";
const H2H_COLOR_B = "#4d7cff";

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
  const [editStats, setEditStats] = useState<string | null>(null);
  const [hA, setHA] = useState("");
  const [hB, setHB] = useState("");

  const load = useCallback(() => api.getTeam(id).then(setTp).catch(() => setTp(null)), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!tp) return <div className="p-10 text-center text-mute">Loading…</div>;
  const r = tp.record;
  const brand = brandColor(tp.team.id);
  const maxDist = Math.max(...tp.leaderboard.map((l) => l.distance_m), 1);
  const lb = tp.leaderboard;
  const lA = lb.find((l) => l.player_id === hA) ?? lb[0];
  const lB = lb.find((l) => l.player_id === hB) ?? lb[1] ?? lb[0];

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

  const btn = "rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold transition hover:border-line-2";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/teams" className="text-sm text-mute hover:text-white">← Teams</Link>

      {/* branded header */}
      <div className="relative mt-2 mb-6 overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(600px 200px at 0% 0%, ${brand}, transparent 70%)` }} />
        <div className="relative flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <Avatar label={initials(tp.team.name)} color={brand} size={56} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{tp.team.name}</h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-mute">
                <span>{tp.player_count} players · {r.played} matches</span>
                {tp.team.public_token && <Badge color="green">shared</Badge>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={share} className={btn}>{tp.team.public_token ? "Unshare" : "Share"}</button>
            <button onClick={exportTeam} className={btn}>Export</button>
            <button onClick={remove} className={`${btn} text-home`}>Delete</button>
          </div>
        </div>
      </div>

      {/* record KPI strip */}
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
          <FieldBreakdown data={tp.matches_by_field} />
        </Card>
        <Card title="Distance leaders" icon="gauge">
          {tp.leaderboard.length === 0 ? (
            <p className="text-sm text-mute">No player stats yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {tp.leaderboard.slice(0, 5).map((l) => (
                <li key={l.player_id} className="flex items-center gap-3">
                  <Avatar label={initials(l.name)} color={brand} size={28}
                    src={l.avatar ? api.playerAvatarUrl(l.player_id) : undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-sm">
                      <Link to={`/players/${l.player_id}`} className="truncate hover:text-white">{l.name}</Link>
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

      {lb.length >= 2 && lA && lB && (
        <Card title="Head-to-head" subtitle="Compare two players across the season" icon="users" className="mt-4">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <select value={lA.player_id} onChange={(e) => setHA(e.target.value)}
              className="rounded-lg border border-line bg-ink-2 p-2 text-sm outline-none focus:border-pitch/60">
              {lb.map((l) => <option key={l.player_id} value={l.player_id}>{l.name}</option>)}
            </select>
            <select value={lB.player_id} onChange={(e) => setHB(e.target.value)}
              className="rounded-lg border border-line bg-ink-2 p-2 text-sm outline-none focus:border-pitch/60">
              {lb.map((l) => <option key={l.player_id} value={l.player_id}>{l.name}</option>)}
            </select>
          </div>
          <HeadToHead
            a={{ name: lA.name, sub: `${lA.matches} matches`, jersey: initials(lA.name), color: H2H_COLOR_A,
                 src: lA.avatar ? api.playerAvatarUrl(lA.player_id) : undefined }}
            b={{ name: lB.name, sub: `${lB.matches} matches`, jersey: initials(lB.name), color: H2H_COLOR_B,
                 src: lB.avatar ? api.playerAvatarUrl(lB.player_id) : undefined }}
            rows={[
              { label: "Goals", a: lA.goals, b: lB.goals },
              { label: "Assists", a: lA.assists ?? 0, b: lB.assists ?? 0 },
              { label: "Attempts (shots)", a: lA.shots ?? 0, b: lB.shots ?? 0 },
              { label: "On target", a: lA.shots_on_target ?? 0, b: lB.shots_on_target ?? 0 },
              { label: "Passes completed", a: lA.passes_completed ?? lA.passes, b: lB.passes_completed ?? lB.passes },
              { label: "Pass accuracy", a: lA.pass_accuracy ?? 0, b: lB.pass_accuracy ?? 0, fmt: (n) => `${n}%` },
              { label: "Distance (km)", a: lA.distance_m / 1000, b: lB.distance_m / 1000, fmt: (n) => n.toFixed(1) },
              { label: "Top speed (km/h)", a: lA.top_speed_ms * 3.6, b: lB.top_speed_ms * 3.6, fmt: (n) => n.toFixed(1) },
              { label: "Fouls", a: lA.fouls ?? 0, b: lB.fouls ?? 0, better: "low" },
            ]}
          />
        </Card>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title={`Roster · ${tp.player_count}`} icon="users">
          <ul className="mb-3 flex flex-col gap-1">
            {tp.players.map((p) => (
              <li key={p.id}>
                <Link to={`/players/${p.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-white/[0.03]">
                  <Avatar label={p.jersey != null ? String(p.jersey) : initials(p.name)} color={brand} size={28}
                    src={p.avatar ? api.playerAvatarUrl(p.id) : undefined} />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-mute">{p.position}</span>
                </Link>
              </li>
            ))}
            {tp.players.length === 0 && <li className="px-2 text-sm text-mute">No players yet.</li>}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Player name"
              className="min-w-0 flex-1 rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm outline-none focus:border-pitch/60" />
            <input value={pPos} onChange={(e) => setPPos(e.target.value)} placeholder="Pos"
              className="w-16 rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm outline-none focus:border-pitch/60" />
            <input value={pNum} onChange={(e) => setPNum(e.target.value)} placeholder="#" inputMode="numeric"
              className="w-14 rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm outline-none focus:border-pitch/60" />
            <label className="flex items-center gap-1 text-xs text-mute">
              <input type="checkbox" checked={pMinor} onChange={(e) => setPMinor(e.target.checked)} />
              minor
            </label>
            <button onClick={addPlayer} className="rounded-lg bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-pitch-dark">Add</button>
          </div>
        </Card>

        <Card title="Matches" icon="film">
          <ul className="mb-3 flex flex-col gap-1">
            {tp.recent_matches.map((m) => (
              <li key={m.id} className="rounded-lg px-2 py-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span><b className="mr-2 text-mute">{m.field_type}v{m.field_type}</b>{m.opponent || "—"}</span>
                  <span className="flex items-center gap-2 text-mute">
                    {m.home_score != null ? <b className="tnum text-slate-200">{m.home_score}–{m.away_score}</b> : null} {m.played_on || ""}
                    {m.job_id && (
                      <button
                        onClick={() => setImporting(importing === m.id ? null : m.id)}
                        className="rounded-md bg-line px-2 py-0.5 text-xs text-pitch hover:bg-line-2"
                        title="Import player stats from the linked analysis"
                      >
                        ↳ analysis
                      </button>
                    )}
                    <button
                      onClick={() => setEditStats(editStats === m.id ? null : m.id)}
                      className="rounded-md bg-line px-2 py-0.5 text-xs hover:bg-line-2"
                      title="Enter goals, assists, shots, fouls"
                    >
                      ✎ stats
                    </button>
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
                {editStats === m.id && (
                  <MatchStatsEditor
                    matchId={m.id}
                    players={tp.players}
                    onDone={() => { setEditStats(null); load(); }}
                  />
                )}
              </li>
            ))}
            {tp.recent_matches.length === 0 && <li className="px-2 text-sm text-mute">No matches yet.</li>}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <select value={mField} onChange={(e) => setMField(e.target.value)}
              className="rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm outline-none focus:border-pitch/60">
              <option value="5">5-a-side</option>
              <option value="7">7-a-side</option>
              <option value="11">11-a-side</option>
            </select>
            <input value={mOpp} onChange={(e) => setMOpp(e.target.value)} placeholder="Opponent"
              className="min-w-0 flex-1 rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm outline-none focus:border-pitch/60" />
            <input value={mHome} onChange={(e) => setMHome(e.target.value)} placeholder="GF" inputMode="numeric"
              className="w-12 rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm outline-none focus:border-pitch/60" />
            <input value={mAway} onChange={(e) => setMAway(e.target.value)} placeholder="GA" inputMode="numeric"
              className="w-12 rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm outline-none focus:border-pitch/60" />
            <button onClick={addMatch} className="rounded-lg bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-pitch-dark">Add</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
