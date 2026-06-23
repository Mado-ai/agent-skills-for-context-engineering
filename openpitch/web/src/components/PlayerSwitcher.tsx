import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Avatar, Card, Icon } from "./ui";
import { brandColor, initials } from "../lib/brand";

type Ref = { id: string; name: string; jersey: number | null; team_id: string; team_name: string };

/* Dashboard quick-access: pick any roster player (across teams) and jump to
 * their account, without leaving the analytics view. */
export default function PlayerSwitcher() {
  const nav = useNavigate();
  const [players, setPlayers] = useState<Ref[]>([]);
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    api.allPlayers().then((list) => {
      setPlayers(list);
      if (list[0]) setSel(list[0].id);
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? players.filter((p) => `${p.name} ${p.team_name} ${p.jersey}`.toLowerCase().includes(t)) : players;
  }, [players, q]);

  const recent = players.slice(0, 4);
  const cur = players.find((p) => p.id === sel);

  return (
    <Card title="Players" subtitle="Open any player's account" icon="users">
      {players.length === 0 ? (
        <p className="text-sm text-mute">
          No players yet — add them in <Link to="/teams" className="text-pitch hover:underline">Teams</Link>.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            {recent.map((p) => (
              <Link key={p.id} to={`/players/${p.id}`}
                className="lift flex items-center gap-2 rounded-full border border-line bg-ink-2 py-1 pl-1 pr-3 text-sm hover:border-line-2"
                title={`${p.team_name} · ${p.name}`}>
                <Avatar label={p.jersey != null ? String(p.jersey) : initials(p.name)} color={brandColor(p.team_id)} size={24} />
                <span className="max-w-28 truncate">{p.name}</span>
              </Link>
            ))}
          </div>

          {players.length > 6 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search players…"
              className="mb-2 w-full rounded-lg border border-line bg-ink-2 px-2.5 py-2 text-sm outline-none focus:border-pitch/60"
            />
          )}
          <div className="flex gap-2">
            <select
              value={sel}
              onChange={(e) => setSel(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-ink-2 px-2 py-2 text-sm outline-none focus:border-pitch/60"
            >
              {filtered.map((p) => (
                <option key={p.id} value={p.id}>{p.team_name} · #{p.jersey ?? "?"} {p.name}</option>
              ))}
            </select>
            <button
              onClick={() => cur && nav(`/players/${cur.id}`)}
              className="flex items-center gap-1 rounded-lg bg-pitch px-3 py-2 text-sm font-semibold text-emerald-950 hover:bg-pitch-dark"
            >
              Open <Icon name="play" width={14} height={14} />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-mute">
            <Link to="/compare" className="hover:text-white">Compare two players →</Link>
            <Link to="/teams" className="hover:text-white">Manage roster</Link>
          </div>
        </>
      )}
    </Card>
  );
}
