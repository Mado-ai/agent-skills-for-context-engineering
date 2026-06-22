import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Member, TeamSummary } from "../types";

const ROLES = ["coach", "admin", "parent", "player", "scout"];

export default function OrgDetail() {
  const { id = "" } = useParams();
  const [role, setRole] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [email, setEmail] = useState("");
  const [mRole, setMRole] = useState("coach");
  const [linkPlayer, setLinkPlayer] = useState("");
  const [teamName, setTeamName] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.listOrgs().then((os) => setRole(os.find((o) => o.id === id)?.role ?? "")).catch(() => {});
    api.orgMembers(id).then(setMembers).catch(() => {});
    api.orgTeams(id).then(setTeams).catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isAdmin = role === "owner" || role === "admin";
  const isStaff = isAdmin || role === "coach";

  const addMember = async () => {
    setMsg("");
    try {
      await api.addMember(id, {
        email: email.trim(),
        role: mRole,
        ...(linkPlayer.trim() ? { player_id: linkPlayer.trim() } : {}),
      });
      setEmail(""); setLinkPlayer("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  };

  const addTeam = async () => {
    if (!teamName.trim()) return;
    await api.createOrgTeam(id, teamName.trim());
    setTeamName("");
    load();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link to="/orgs" className="text-sm text-slate-400 hover:text-white">← Organizations</Link>
      <h1 className="text-2xl font-bold">Organization</h1>
      <p className="mb-6 text-sm text-slate-400">Your role: <b className="capitalize">{role || "—"}</b></p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Members</h2>
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex justify-between rounded px-2 py-1.5">
                <span>{m.email}</span>
                <span className="text-slate-400 capitalize">
                  {m.role}{m.player_id ? " · linked" : ""}
                </span>
              </li>
            ))}
          </ul>
          {isAdmin && (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@email.com"
                className="rounded border border-line bg-ink px-2 py-1.5 text-sm" />
              <div className="flex gap-2">
                <select value={mRole} onChange={(e) => setMRole(e.target.value)}
                  className="rounded border border-line bg-ink px-2 py-1.5 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {(mRole === "parent" || mRole === "player") && (
                  <input value={linkPlayer} onChange={(e) => setLinkPlayer(e.target.value)} placeholder="player_id"
                    className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
                )}
                <button onClick={addMember} className="rounded bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950">Add</button>
              </div>
              {msg && <p className="text-xs text-red-400">{msg}</p>}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Teams</h2>
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {teams.map((t) => (
              <li key={t.id}>
                <Link to={`/teams/${t.id}`} className="flex justify-between rounded px-2 py-1.5 hover:bg-ink">
                  <span>{t.name}</span>
                  <span className="text-slate-500">{t.player_count} players</span>
                </Link>
              </li>
            ))}
            {teams.length === 0 && <li className="text-slate-400">No teams yet.</li>}
          </ul>
          {isStaff && (
            <div className="flex gap-2 border-t border-line pt-3">
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name"
                className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
              <button onClick={addTeam} className="rounded bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950">Add</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
