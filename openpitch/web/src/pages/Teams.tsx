import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Avatar, Badge, Icon } from "../components/ui";
import { brandColor, initials } from "../lib/brand";
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
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Teams</h1>
          <p className="text-sm text-mute">Squads, rosters and match history</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
          />
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold transition hover:border-line-2">
            <Icon name="upload" width={15} height={15} /> Import
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-2 rounded-2xl border border-line bg-card p-3 shadow-card">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New team name"
          className="flex-1 rounded-xl border border-line bg-ink-2 p-2.5 text-sm outline-none focus:border-pitch/60"
        />
        <button onClick={create} className="rounded-xl bg-pitch px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-pitch-dark">
          Create team
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-home">{error}</p>}

      {teams.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-line-2 py-16 text-center">
          <Icon name="users" width={26} height={26} className="mb-2 text-mute" />
          <p className="text-sm text-mute">No teams yet — create one or import a bundle.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => {
            const c = brandColor(t.id);
            return (
              <Link
                key={t.id}
                to={`/teams/${t.id}`}
                className="lift group relative overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-card hover:border-line-2"
              >
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: c }} />
                <div className="flex items-center gap-3">
                  <Avatar label={initials(t.name)} color={c} size={44} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{t.name}</div>
                    <div className="mt-0.5 text-xs text-mute">
                      {t.player_count} players · {t.match_count} matches
                    </div>
                  </div>
                </div>
                {t.public_token && (
                  <span className="absolute right-3 top-3"><Badge color="green">shared</Badge></span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
