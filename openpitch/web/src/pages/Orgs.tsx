import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Org } from "../types";

export default function Orgs() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const refresh = () => api.listOrgs().then(setOrgs).catch(() => {});
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setError("");
    try {
      await api.createOrg(name.trim());
      setName("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Organizations</h1>
      <p className="mb-6 text-sm text-slate-400">
        Clubs and academies. Members get roles — coach, parent, player, scout — that control what they see.
      </p>

      <div className="mb-6 flex gap-2 rounded-xl border border-line bg-card p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Organization name"
          className="flex-1 rounded-lg border border-line bg-ink p-2.5 text-sm"
        />
        <button onClick={create} className="rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-emerald-950">
          Create
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {orgs.length === 0 ? (
        <p className="text-slate-400">No organizations yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {orgs.map((o) => (
            <Link key={o.id} to={`/orgs/${o.id}`} className="flex items-center justify-between rounded-xl border border-line bg-card p-4 hover:border-pitch">
              <span className="font-semibold">{o.name}</span>
              <span className="rounded-full bg-line px-2 py-0.5 text-xs capitalize text-slate-300">{o.role}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
