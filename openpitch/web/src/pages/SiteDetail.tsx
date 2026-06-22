import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Device, Site, SiteJob } from "../types";

function deviceOnline(lastSeen: number | null): boolean {
  return lastSeen != null && Date.now() / 1000 - lastSeen < 300;
}

export default function SiteDetail() {
  const { id = "" } = useParams();
  const [site, setSite] = useState<(Site & { devices: Device[] }) | null>(null);
  const [matches, setMatches] = useState<SiteJob[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [kind, setKind] = useState("gateway");
  const [dName, setDName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getSite(id).then((s) => setSite(s)).catch(() => setSite(null));
    api.siteMatches(id).then(setMatches).catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
    api.packages().then((m) => setKinds(m.device_kinds ?? [])).catch(() => {});
  }, [load]);

  if (!site) return <div className="p-10 text-center text-slate-400">Loading…</div>;

  const pair = async () => {
    if (!dName.trim()) return;
    const res = await api.pairDevice(id, kind, dName.trim());
    setNewKey(res.api_key);
    setDName("");
    load();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link to="/sites" className="text-sm text-slate-400 hover:text-white">← Sites</Link>
      <h1 className="text-2xl font-bold">{site.name}</h1>
      <p className="mb-6 text-sm text-slate-400 capitalize">{site.package} package</p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Devices</h2>
          {site.devices.length === 0 ? (
            <p className="text-sm text-slate-400">No devices paired yet.</p>
          ) : (
            <ul className="mb-4 flex flex-col gap-1">
              {site.devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm">
                  <span>
                    <span className="text-slate-500">{d.kind}</span> · {d.name}
                  </span>
                  <span className={deviceOnline(d.last_seen) ? "text-pitch" : "text-slate-500"}>
                    ● {deviceOnline(d.last_seen) ? "online" : "offline"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <select value={kind} onChange={(e) => setKind(e.target.value)}
              className="rounded border border-line bg-ink px-2 py-1.5 text-sm">
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="Device name"
              className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1.5 text-sm" />
            <button onClick={pair} className="rounded bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950">
              Pair
            </button>
          </div>

          {newKey && (
            <div className="mt-3 rounded-lg border border-pitch/50 bg-ink p-3">
              <p className="text-xs text-slate-400">Device API key — shown once. Store it on the gateway:</p>
              <code className="mt-1 block break-all text-xs text-pitch">{newKey}</code>
              <button
                onClick={() => { navigator.clipboard?.writeText(newKey); }}
                className="mt-2 rounded bg-line px-2 py-1 text-xs"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 font-semibold">Synced matches</h2>
          {matches.length === 0 ? (
            <p className="text-sm text-slate-400">
              No matches yet. Once the gateway syncs a match, it appears here automatically.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {matches.map((j) => (
                <li key={j.id} className="flex justify-between rounded px-2 py-1.5 text-sm">
                  <span className="truncate">{j.input_name}</span>
                  <span className="text-slate-400">{j.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-line bg-card p-5 text-sm text-slate-400">
        <b className="text-slate-200">How sync works:</b> the paired gateway authenticates with its
        device key and POSTs each processed match to <code>/api/ingest/matches</code> (idempotent).
        Matches land here and in your dashboard analyses automatically.
      </div>
    </div>
  );
}
