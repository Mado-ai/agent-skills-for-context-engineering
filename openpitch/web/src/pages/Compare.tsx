import { useEffect, useState } from "react";
import { api } from "../api/client";
import HeadToHead, { type H2HRow } from "../components/HeadToHead";
import { Card, Icon } from "../components/ui";
import { brandColor, initials } from "../lib/brand";
import type { PlayerProfile } from "../types";

type Ref = { id: string; name: string; jersey: number | null; team_id: string; team_name: string };

function rows(a: PlayerProfile["totals"], b: PlayerProfile["totals"]): H2HRow[] {
  return [
    { label: "Goals", a: a.goals, b: b.goals },
    { label: "Assists", a: a.assists, b: b.assists },
    { label: "Attempts (shots)", a: a.shots ?? 0, b: b.shots ?? 0 },
    { label: "On target", a: a.shots_on_target ?? 0, b: b.shots_on_target ?? 0 },
    { label: "Passes completed", a: a.passes_completed ?? a.passes, b: b.passes_completed ?? b.passes },
    { label: "Pass accuracy", a: a.pass_accuracy ?? 0, b: b.pass_accuracy ?? 0, fmt: (n) => `${n}%` },
    { label: "Distance (km)", a: a.distance_m / 1000, b: b.distance_m / 1000, fmt: (n) => n.toFixed(1) },
    { label: "Top speed (km/h)", a: a.top_speed_ms * 3.6, b: b.top_speed_ms * 3.6, fmt: (n) => n.toFixed(1) },
    { label: "Sprints", a: a.sprints, b: b.sprints },
    { label: "Fouls", a: a.fouls ?? 0, b: b.fouls ?? 0, better: "low" },
  ];
}

export default function Compare() {
  const [refs, setRefs] = useState<Ref[]>([]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [a, setA] = useState<PlayerProfile | null>(null);
  const [b, setB] = useState<PlayerProfile | null>(null);

  useEffect(() => {
    api.allPlayers().then((list) => {
      setRefs(list);
      if (list[0]) setAId(list[0].id);
      // default the second pick to a different team where possible
      const other = list.find((p) => p.team_id !== list[0]?.team_id) ?? list[1];
      if (other) setBId(other.id);
    }).catch(() => {});
  }, []);

  useEffect(() => { if (aId) api.getPlayer(aId).then(setA).catch(() => setA(null)); }, [aId]);
  useEffect(() => { if (bId) api.getPlayer(bId).then(setB).catch(() => setB(null)); }, [bId]);

  const refOf = (id: string) => refs.find((r) => r.id === id);
  const opt = (r: Ref) => `${r.team_name} · #${r.jersey ?? "?"} ${r.name}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Compare players</h1>
      <p className="mb-6 text-sm text-mute">Head-to-head across any two players — including different teams.</p>

      {refs.length < 2 ? (
        <Card className="grid place-items-center py-16" pad>
          <div className="text-center">
            <Icon name="users" width={26} height={26} className="mx-auto mb-2 text-mute" />
            <p className="text-sm text-mute">Add players with recorded match stats to compare them.</p>
          </div>
        </Card>
      ) : (
        <Card icon="users" title="Head-to-head">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <select value={aId} onChange={(e) => setAId(e.target.value)}
              className="rounded-lg border border-line bg-ink-2 p-2 text-sm outline-none focus:border-pitch/60">
              {refs.map((r) => <option key={r.id} value={r.id}>{opt(r)}</option>)}
            </select>
            <select value={bId} onChange={(e) => setBId(e.target.value)}
              className="rounded-lg border border-line bg-ink-2 p-2 text-sm outline-none focus:border-pitch/60">
              {refs.map((r) => <option key={r.id} value={r.id}>{opt(r)}</option>)}
            </select>
          </div>
          {a && b && refOf(aId) && refOf(bId) ? (
            <HeadToHead
              a={{ name: a.player.name, sub: `${refOf(aId)!.team_name} · ${a.totals.matches} matches`,
                   jersey: a.player.jersey ?? initials(a.player.name), color: brandColor(a.team_id) }}
              b={{ name: b.player.name, sub: `${refOf(bId)!.team_name} · ${b.totals.matches} matches`,
                   jersey: b.player.jersey ?? initials(b.player.name), color: brandColor(b.team_id) }}
              rows={rows(a.totals, b.totals)}
            />
          ) : (
            <p className="py-8 text-center text-sm text-mute">Loading…</p>
          )}
        </Card>
      )}
    </div>
  );
}
