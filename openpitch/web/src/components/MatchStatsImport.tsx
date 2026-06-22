import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Detected {
  player_id: number;
  team: string;
  distance_m: number;
  top_speed_ms: number;
}
interface Roster {
  id: string;
  name: string;
  jersey: number | null;
}

export default function MatchStatsImport({
  matchId,
  onDone,
}: {
  matchId: string;
  onDone: () => void;
}) {
  const [detected, setDetected] = useState<Detected[]>([]);
  const [roster, setRoster] = useState<Roster[]>([]);
  const [map, setMap] = useState<Record<number, string>>({});
  const [minutes, setMinutes] = useState("90");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.matchDetected(matchId).then((d) => {
      const det = [...d.detected].sort((a, b) => b.distance_m - a.distance_m);
      setDetected(det);
      setRoster(d.roster);
    });
  }, [matchId]);

  // Best-effort: assign highest-distance detections to roster in order.
  const autoAssign = () => {
    const next: Record<number, string> = {};
    detected.forEach((d, i) => {
      if (roster[i]) next[d.player_id] = roster[i].id;
    });
    setMap(next);
  };

  const submit = async () => {
    const mapping = Object.entries(map)
      .filter(([, pid]) => pid)
      .map(([detected_id, player_id]) => ({ detected_id: Number(detected_id), player_id }));
    if (mapping.length === 0) {
      setMsg("Assign at least one player.");
      return;
    }
    const res = await api.importMatchStats(matchId, mapping, Number(minutes) || 0);
    setMsg(`Imported ${res.imported} player(s).`);
    onDone();
  };

  if (detected.length === 0) {
    return <p className="mt-2 text-xs text-slate-400">No detected players on the linked analysis.</p>;
  }

  return (
    <div className="mt-2 rounded-lg border border-line bg-ink p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">Map detected players → roster</span>
        <button onClick={autoAssign} className="rounded bg-line px-2 py-1 text-xs font-semibold">
          Auto-assign
        </button>
      </div>
      <div className="flex max-h-48 flex-col gap-1 overflow-auto">
        {detected.slice(0, 12).map((d) => (
          <div key={d.player_id} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 text-slate-400">
              {d.team} · {(d.distance_m / 1000).toFixed(1)}km
            </span>
            <select
              value={map[d.player_id] ?? ""}
              onChange={(e) => setMap({ ...map, [d.player_id]: e.target.value })}
              className="flex-1 rounded border border-line bg-card px-2 py-1"
            >
              <option value="">— unassigned —</option>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.jersey != null ? `#${p.jersey} ` : ""}{p.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          inputMode="numeric"
          className="w-16 rounded border border-line bg-card px-2 py-1 text-xs"
          placeholder="mins"
        />
        <button onClick={submit} className="rounded bg-pitch px-3 py-1 text-xs font-semibold text-emerald-950">
          Import stats
        </button>
        {msg && <span className="text-xs text-pitch">{msg}</span>}
      </div>
    </div>
  );
}
