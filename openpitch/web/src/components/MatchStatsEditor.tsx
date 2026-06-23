import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Player } from "../types";

/* Manual entry for the standard-data event taxonomy + the stats tracking can't
 * derive. Edits one player at a time and merges server-side, so auto-imported
 * distance/speed/passes are preserved. */

const GROUPS: { title: string; fields: { key: string; label: string }[] }[] = [
  { title: "Attacking", fields: [
    { key: "goals", label: "Goals" }, { key: "assists", label: "Assists" },
    { key: "shots", label: "Shots" }, { key: "shots_on_target", label: "On target" },
    { key: "key_passes", label: "Key passes" }, { key: "crosses", label: "Crosses" },
    { key: "dribbles", label: "Dribbles" },
  ] },
  { title: "Defending", fields: [
    { key: "tackles", label: "Tackles" }, { key: "interceptions", label: "Interceptions" },
    { key: "clearances", label: "Clearances" }, { key: "blocks", label: "Blocks" },
    { key: "duels_won", label: "Duels won" }, { key: "recoveries", label: "Recoveries" },
    { key: "saves", label: "Saves (GK)" },
  ] },
  { title: "Discipline", fields: [
    { key: "fouls", label: "Fouls" }, { key: "offsides", label: "Offsides" },
    { key: "yellow_cards", label: "Yellow" }, { key: "red_cards", label: "Red" },
  ] },
];
const KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

export default function MatchStatsEditor({
  matchId, players, onDone,
}: {
  matchId: string; players: Player[]; onDone: () => void;
}) {
  const [pid, setPid] = useState(players[0]?.id ?? "");
  const [vals, setVals] = useState<Record<string, Record<string, number>>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.matchStats(matchId).then((d) => {
      const map: Record<string, Record<string, number>> = {};
      for (const s of d.stats as unknown as Record<string, number>[]) {
        const row: Record<string, number> = {};
        for (const k of KEYS) row[k] = Number(s[k] ?? 0);
        map[String(s.player_id)] = row;
      }
      setVals(map);
    }).catch(() => {});
  }, [matchId]);
  useEffect(() => { load(); }, [load]);

  const cur = vals[pid] ?? {};
  const set = (k: string, v: string) =>
    setVals((m) => ({ ...m, [pid]: { ...(m[pid] ?? {}), [k]: Math.max(0, parseInt(v || "0", 10) || 0) } }));

  const save = async () => {
    if (!pid) return;
    setSaving(true);
    try {
      const fields: Record<string, string> = { player_id: pid };
      for (const k of KEYS) fields[k] = String(cur[k] ?? 0);
      await api.setPlayerStat(matchId, fields);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-line bg-ink-2 p-3">
      <select value={pid} onChange={(e) => setPid(e.target.value)}
        className="mb-3 w-full rounded-lg border border-line bg-card px-2 py-2 text-sm outline-none focus:border-pitch/60">
        {players.map((p) => <option key={p.id} value={p.id}>#{p.jersey ?? "?"} {p.name}</option>)}
      </select>
      <div className="flex flex-col gap-3">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-mute">{g.title}</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {g.fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-[0.7rem] text-mute">{f.label}</span>
                  <input inputMode="numeric" value={String(cur[f.key] ?? 0)}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full rounded border border-line bg-card px-2 py-1 text-center text-sm tnum outline-none focus:border-pitch/60" />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onDone} className="rounded-lg border border-line px-3 py-1.5 text-sm">Close</button>
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-pitch-dark disabled:opacity-50">
          {saving ? "Saving…" : "Save player"}
        </button>
      </div>
    </div>
  );
}
