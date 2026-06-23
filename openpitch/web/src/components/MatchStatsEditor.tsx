import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Player } from "../types";

/* Manual entry for the match-event stats that tracking can't derive
 * (goals, assists, shots, shots on target, fouls). Merges with auto-imported
 * distance/speed/passes server-side, so this never wipes those. */

type Manual = { goals: number; assists: number; shots: number; shots_on_target: number; fouls: number };
const FIELDS: { key: keyof Manual; label: string }[] = [
  { key: "goals", label: "G" },
  { key: "assists", label: "A" },
  { key: "shots", label: "Sh" },
  { key: "shots_on_target", label: "OnT" },
  { key: "fouls", label: "F" },
];
const ZERO: Manual = { goals: 0, assists: 0, shots: 0, shots_on_target: 0, fouls: 0 };

export default function MatchStatsEditor({
  matchId, players, brand, onDone,
}: {
  matchId: string; players: Player[]; brand: string; onDone: () => void;
}) {
  const [rows, setRows] = useState<Record<string, Manual>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.matchStats(matchId).then((d) => {
      const map: Record<string, Manual> = {};
      for (const p of players) map[p.id] = { ...ZERO };
      for (const s of d.stats) {
        map[s.player_id] = {
          goals: s.goals || 0, assists: s.assists || 0, shots: s.shots || 0,
          shots_on_target: s.shots_on_target || 0, fouls: s.fouls || 0,
        };
      }
      setRows(map);
    }).catch(() => {});
  }, [matchId, players]);
  useEffect(() => { load(); }, [load]);

  const set = (pid: string, key: keyof Manual, v: string) =>
    setRows((r) => ({ ...r, [pid]: { ...(r[pid] ?? ZERO), [key]: Math.max(0, parseInt(v || "0", 10) || 0) } }));

  const save = async () => {
    setSaving(true);
    try {
      for (const p of players) {
        const m = rows[p.id] ?? ZERO;
        await api.setPlayerStat(matchId, {
          player_id: p.id, goals: String(m.goals), assists: String(m.assists),
          shots: String(m.shots), shots_on_target: String(m.shots_on_target), fouls: String(m.fouls),
        });
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-line bg-ink-2 p-3">
      <div className="mb-2 grid grid-cols-[1fr_repeat(5,2.4rem)] items-center gap-1 text-[0.65rem] uppercase tracking-wide text-mute">
        <span>Player</span>
        {FIELDS.map((f) => <span key={f.key} className="text-center">{f.label}</span>)}
      </div>
      <div className="flex max-h-64 flex-col gap-1 overflow-auto">
        {players.map((p) => (
          <div key={p.id} className="grid grid-cols-[1fr_repeat(5,2.4rem)] items-center gap-1">
            <span className="flex items-center gap-2 truncate text-sm">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.6rem] font-bold text-white"
                style={{ background: brand }}>{p.jersey ?? "?"}</span>
              <span className="truncate">{p.name}</span>
            </span>
            {FIELDS.map((f) => (
              <input
                key={f.key}
                inputMode="numeric"
                value={String(rows[p.id]?.[f.key] ?? 0)}
                onChange={(e) => set(p.id, f.key, e.target.value)}
                className="w-full rounded border border-line bg-card px-1 py-1 text-center text-sm tnum outline-none focus:border-pitch/60"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onDone} className="rounded-lg border border-line px-3 py-1.5 text-sm">Cancel</button>
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-pitch-dark disabled:opacity-50">
          {saving ? "Saving…" : "Save stats"}
        </button>
      </div>
    </div>
  );
}
