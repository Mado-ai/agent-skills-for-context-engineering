import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { Avatar, Card, Icon, StatCard } from "../components/ui";
import { brandColor, initials } from "../lib/brand";
import type { ScoutingReport, Shot } from "../types";

const ACCENT = "#2ee27a";

export default function Scouting() {
  const { teamId = "" } = useParams();
  const [sc, setSc] = useState<ScoutingReport | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.scouting(teamId).then(setSc).catch(() => setErr(true));
  }, [teamId]);

  if (err) return <div className="p-10 text-center text-mute">Could not load scouting report.</div>;
  if (!sc) return <div className="p-10 text-center text-mute">Loading…</div>;

  const brand = brandColor(sc.team.id);
  const r = sc.record;
  const ch = sc.attacking.channel_pct;
  const favoured = sc.attacking.favoured_channel;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between">
        <Link to={`/teams/${teamId}`} className="text-sm text-mute hover:text-white">← Team</Link>
        <Link to={`/report/team/${teamId}`} className="rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold hover:border-line-2">
          Printable report
        </Link>
      </div>

      <div className="relative mt-2 mb-6 overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(600px 220px at 100% 0%, ${brand}, transparent 70%)` }} />
        <div className="relative flex items-center gap-3 p-5">
          <div className="grid h-11 w-11 place-items-center rounded-2xl text-emerald-950" style={{ background: brand }}>
            <Icon name="target" width={22} height={22} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-mute">Opponent scouting</p>
            <h1 className="text-2xl font-bold tracking-tight">{sc.team.name}</h1>
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Played" value={r.played} icon="shield" accent="violet" />
        <StatCard label="Record" value={`${r.wins}-${r.draws}-${r.losses}`} icon="activity" accent="pitch" />
        <StatCard label="Goals for" value={r.goals_for} icon="target" accent="pitch" />
        <StatCard label="Against" value={r.goals_against} icon="shield" accent="home" />
        <StatCard label="Shots" value={sc.totals.shots} icon="crosshair" accent="amber" />
        <StatCard label="Possession" value={sc.attacking.possession_avg ?? "—"} unit={sc.attacking.possession_avg != null ? "%" : ""} icon="route" accent="away" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Danger men" subtitle="Ranked by goal threat" icon="zap">
          {sc.danger_men.length === 0 ? (
            <p className="text-sm text-mute">No player data yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sc.danger_men.map((p, i) => (
                <li key={p.player_id} className="flex items-center gap-3 rounded-lg border border-line bg-ink-2 px-3 py-2">
                  <span className="tnum w-5 text-center text-sm font-bold text-mute">{i + 1}</span>
                  <Avatar label={initials(p.name)} color={brandColor(p.player_id)} size={30} />
                  <Link to={`/players/${p.player_id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-pitch">{p.name}</Link>
                  <span className="tnum flex gap-3 text-xs text-mute">
                    <span><b className="text-slate-200">{p.goals}</b> G</span>
                    <span><b className="text-slate-200">{p.assists ?? 0}</b> A</span>
                    <span><b className="text-slate-200">{p.shots ?? 0}</b> Sh</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Attacking tendencies" subtitle="Where they build their attacks" icon="route">
          {favoured ? (
            <>
              <p className="mb-3 text-sm text-slate-300">
                Favours the <b className="capitalize" style={{ color: ACCENT }}>{favoured}</b> channel
                {" · "}{sc.attacking.final_third_entries} final-third entries.
              </p>
              <div className="flex flex-col gap-3">
                {(["left", "center", "right"] as const).map((k) => (
                  <div key={k}>
                    <div className="mb-1 flex justify-between text-xs capitalize text-mute">
                      <span>{k}</span><span className="tnum">{ch[k]}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full" style={{ width: `${ch[k]}%`, background: k === favoured ? ACCENT : "#4d7cff" }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-mute">Attacking-channel data appears once a match is analysed with tracking.</p>
          )}
        </Card>
      </div>

      {sc.snapshot && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card title="Shot map" subtitle={`From ${sc.snapshot.opponent ? `vs ${sc.snapshot.opponent}` : "latest analysed match"} · all attacking →`} icon="target">
            <ShotMini shots={sc.snapshot.shots} />
          </Card>
          <Card title="Territory" subtitle="Where they spend time (own half left)" icon="flame">
            <ZoneMini grid={sc.snapshot.zones} color={brand} />
          </Card>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-mute">
        Scouting built from {sc.matches} recorded match{sc.matches === 1 ? "" : "es"}.
      </p>
    </div>
  );
}

const L = 100, W = 64;

function ShotMini({ shots }: { shots: Shot[] }) {
  if (!shots || shots.length === 0)
    return <p className="py-10 text-center text-sm text-mute">No shots in the latest analysed match.</p>;
  return (
    <svg viewBox={`0 0 ${L} ${W}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <rect width={L} height={W} rx="2" fill="#0f1a12" />
      <g stroke="#2b3543" strokeWidth="0.4" fill="none">
        <rect x="1.5" y="1.5" width={L - 3} height={W - 3} />
        <line x1={L / 2} y1="1.5" x2={L / 2} y2={W - 1.5} />
        <circle cx={L / 2} cy={W / 2} r="9.15" />
        <rect x={L - 18} y={W / 2 - 20} width="16.5" height="40" />
      </g>
      {shots.map((s, i) => {
        const rr = 0.8 + Math.sqrt(Math.max(0, s.xg)) * 6.5;
        return <circle key={i} cx={3 + s.xn * (L - 6)} cy={3 + s.yn * (W - 6)} r={rr}
          fill="#ff5a5a" fillOpacity={0.3} stroke="#ff5a5a" strokeWidth="0.4" />;
      })}
    </svg>
  );
}

function ZoneMini({ grid, color }: { grid: number[]; color: string }) {
  if (!grid || grid.length < 18)
    return <p className="py-10 text-center text-sm text-mute">No territory data in the latest analysed match.</p>;
  const max = Math.max(0.001, ...grid);
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {[0, 1, 2].map((band) => (
        <div key={band} className="grid grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((c) => {
            const v = grid[band * 6 + c] ?? 0;
            return <div key={c} className="aspect-[3/2] border border-ink/40"
              style={{ background: color, opacity: 0.08 + 0.8 * (v / max) }} />;
          })}
        </div>
      ))}
    </div>
  );
}
