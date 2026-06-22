import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { TeamSummary } from "../types";

export default function Teams() {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => api.listTeams().then(setTeams).catch(() => {});
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setError("");
    try {
      await api.createTeam(name.trim());
      setName("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const importFile = async (file: File) => {
    setError("");
    try {
      const bundle = JSON.parse(await file.text());
      await api.importTeam(bundle);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid file");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams</h1>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
          />
          <button onClick={() => fileRef.current?.click()} className="rounded-lg bg-line px-4 py-2 text-sm font-semibold">
            Import team
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-2 rounded-xl border border-line bg-card p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New team name"
          className="flex-1 rounded-lg border border-line bg-ink p-2.5 text-sm"
        />
        <button onClick={create} className="rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-emerald-950">
          Create
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {teams.length === 0 ? (
        <p className="text-slate-400">No teams yet — create one or import a bundle.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => (
            <Link
              key={t.id}
              to={`/teams/${t.id}`}
              className="rounded-xl border border-line bg-card p-4 hover:border-pitch"
            >
              <div className="font-semibold">{t.name}</div>
              <div className="mt-1 text-sm text-slate-400">
                {t.player_count} players · {t.match_count} matches
                {t.public_token && <span className="ml-2 text-pitch">● shared</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
