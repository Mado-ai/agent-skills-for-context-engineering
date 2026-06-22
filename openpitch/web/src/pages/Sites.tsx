import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Site } from "../types";

type Pkg = { id: string; name: string; pitch: string; camera_count: number };

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [name, setName] = useState("");
  const [pkg, setPkg] = useState("growth");
  const [error, setError] = useState("");

  const refresh = () => api.listSites().then(setSites).catch(() => {});
  useEffect(() => {
    void refresh();
    api.packages().then((m) => setPackages(m.packages)).catch(() => {});
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setError("");
    try {
      await api.createSite(name.trim(), pkg);
      setName("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Capture sites</h1>
      <p className="mb-6 text-sm text-slate-400">
        Register a pitch deployment, then pair its on-site gateway so matches sync automatically.
      </p>

      <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-line bg-card p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Site name (e.g. North Pitch)"
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink p-2.5 text-sm"
        />
        <select value={pkg} onChange={(e) => setPkg(e.target.value)}
          className="rounded-lg border border-line bg-ink p-2.5 text-sm">
          {packages.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.pitch}</option>
          ))}
        </select>
        <button onClick={create} className="rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-emerald-950">
          Create site
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {sites.length === 0 ? (
        <p className="text-slate-400">No sites yet — create one to begin onboarding hardware.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sites.map((s) => (
            <Link key={s.id} to={`/sites/${s.id}`} className="rounded-xl border border-line bg-card p-4 hover:border-pitch">
              <div className="font-semibold">{s.name}</div>
              <div className="mt-1 text-sm text-slate-400">
                <span className="capitalize">{s.package}</span> package · {s.device_count ?? 0} devices
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
