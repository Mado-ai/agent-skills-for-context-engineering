import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { brandColor } from "../lib/brand";
import { fmtBench } from "../components/ProfileInsights";
import type { PlayerProfile, TeamProfile } from "../types";

/** A light-themed, print-optimised one-pager. "Save as PDF" from the browser
 *  print dialog turns it into a shareable report — no server-side PDF deps. */
export default function Report({ kind }: { kind: "player" | "team" }) {
  const { id = "" } = useParams();
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [team, setTeam] = useState<TeamProfile | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (kind === "player") api.getPlayer(id).then(setPlayer).catch(() => setErr(true));
    else api.getTeam(id).then(setTeam).catch(() => setErr(true));
  }, [kind, id]);

  if (err) return <Shell><p className="text-center text-slate-500">Report not found.</p></Shell>;
  if (kind === "player" && !player) return <Shell><p className="text-center text-slate-500">Loading…</p></Shell>;
  if (kind === "team" && !team) return <Shell><p className="text-center text-slate-500">Loading…</p></Shell>;

  return kind === "player" ? <PlayerReport p={player!} /> : <TeamReport t={team!} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="report-page min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-8 py-10">{children}</div>
    </div>
  );
}

function PrintBar({ back }: { back: string }) {
  return (
    <div className="no-print mb-6 flex items-center justify-between">
      <Link to={back} className="text-sm text-slate-500 hover:text-slate-800">← Back</Link>
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}

function Header({ name, brand, sub }: { name: string; brand: string; sub: string }) {
  return (
    <div className="report-block mb-6 flex items-center justify-between border-b-2 pb-4" style={{ borderColor: brand }}>
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: brand }}>
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: brand }} />
          OpenPitch Report
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{name}</h1>
        <p className="text-sm text-slate-500">{sub}</p>
      </div>
      <div className="text-right text-xs text-slate-400">
        <div>Generated</div>
        <div className="font-semibold text-slate-600">{new Date().toLocaleDateString()}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
      <div className="text-xl font-bold text-slate-900">
        {value}
        {unit && <span className="ml-0.5 text-sm font-medium text-slate-400">{unit}</span>}
      </div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-block mb-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">{title}</h2>
      {children}
    </div>
  );
}

function PlayerReport({ p }: { p: PlayerProfile }) {
  const brand = brandColor(p.team_id);
  const t = p.totals;
  return (
    <Shell>
      <PrintBar back={`/players/${p.player.id}`} />
      <Header
        name={p.player.name}
        brand={brand}
        sub={[p.player.jersey != null ? `#${p.player.jersey}` : null, p.player.position]
          .filter(Boolean)
          .join(" · ") || "Player report"}
      />

      <Section title="Season at a glance">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Stat label="Matches" value={t.matches} />
          <Stat label="Goals" value={t.goals} />
          <Stat label="Assists" value={t.assists} />
          <Stat label="Distance" value={(t.distance_m / 1000).toFixed(1)} unit="km" />
          <Stat label="Sprints" value={t.sprints} />
          <Stat label="Top speed" value={t.top_speed_ms} unit="m/s" />
        </div>
      </Section>

      <Section title="Attacking & passing">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Stat label="Shots" value={t.shots ?? 0} />
          <Stat label="On target" value={t.shots_on_target ?? 0} />
          <Stat label="Key passes" value={t.key_passes ?? 0} />
          <Stat label="Passes" value={t.passes} />
          <Stat label="Pass acc." value={t.pass_accuracy != null ? `${t.pass_accuracy}%` : "—"} />
          <Stat label="Crosses" value={t.crosses ?? 0} />
        </div>
      </Section>

      <Section title="Defending & discipline">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Stat label="Tackles" value={t.tackles ?? 0} />
          <Stat label="Intercept." value={t.interceptions ?? 0} />
          <Stat label="Clearances" value={t.clearances ?? 0} />
          <Stat label="Recoveries" value={t.recoveries ?? 0} />
          <Stat label="Yellow" value={t.yellow_cards ?? 0} />
          <Stat label="Red" value={t.red_cards ?? 0} />
        </div>
      </Section>

      {p.benchmarks && p.benchmarks.length > 0 && (
        <Section title="Squad benchmarks">
          <div className="flex flex-col gap-2.5">
            {p.benchmarks.map((b) => (
              <div key={b.key}>
                <div className="mb-0.5 flex justify-between text-xs text-slate-600">
                  <span>{b.label}</span>
                  <span>
                    <b className="text-slate-900">{fmtBench(b.key, b.value)}</b> · {b.percentile}th pct
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full" style={{ width: `${b.percentile}%`, background: brand }} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {p.recent.length > 0 && (
        <Section title="Recent matches">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="py-1.5 font-medium">Opponent</th>
                <th className="font-medium">Date</th>
                <th className="text-right font-medium">Dist</th>
                <th className="text-right font-medium">Top</th>
                <th className="text-right font-medium">G</th>
                <th className="text-right font-medium">A</th>
              </tr>
            </thead>
            <tbody>
              {p.recent.slice(0, 8).map((m) => (
                <tr key={m.match_id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-1.5">{m.opponent || "—"}</td>
                  <td className="text-slate-400">{m.played_on || "—"}</td>
                  <td className="text-right">{((m.distance_m || 0) / 1000).toFixed(1)} km</td>
                  <td className="text-right">{m.top_speed_ms || 0}</td>
                  <td className="text-right">{m.goals || 0}</td>
                  <td className="text-right">{m.assists || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <p className="mt-8 text-center text-xs text-slate-400">
        Generated by OpenPitch · play-metrics analytics
      </p>
    </Shell>
  );
}

function TeamReport({ t }: { t: TeamProfile }) {
  const brand = brandColor(t.team.id);
  const r = t.record;
  return (
    <Shell>
      <PrintBar back={`/teams/${t.team.id}`} />
      <Header name={t.team.name} brand={brand} sub={`${t.player_count} players · ${r.played} matches`} />

      <Section title="Record">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Stat label="Played" value={r.played} />
          <Stat label="Won" value={r.wins} />
          <Stat label="Drawn" value={r.draws} />
          <Stat label="Lost" value={r.losses} />
          <Stat label="Goals for" value={r.goals_for} />
          <Stat label="Against" value={r.goals_against} />
        </div>
      </Section>

      <Section title="Squad leaderboard">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
              <th className="py-1.5 font-medium">Player</th>
              <th className="text-right font-medium">Apps</th>
              <th className="text-right font-medium">Dist</th>
              <th className="text-right font-medium">Top</th>
              <th className="text-right font-medium">Goals</th>
              <th className="text-right font-medium">Assists</th>
            </tr>
          </thead>
          <tbody>
            {t.leaderboard.map((p) => (
              <tr key={p.player_id} className="border-b border-slate-100 text-slate-700">
                <td className="py-1.5 font-medium text-slate-900">{p.name}</td>
                <td className="text-right">{p.matches}</td>
                <td className="text-right">{(p.distance_m / 1000).toFixed(1)} km</td>
                <td className="text-right">{p.top_speed_ms}</td>
                <td className="text-right">{p.goals}</td>
                <td className="text-right">{p.assists ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <p className="mt-8 text-center text-xs text-slate-400">
        Generated by OpenPitch · play-metrics analytics
      </p>
    </Shell>
  );
}
