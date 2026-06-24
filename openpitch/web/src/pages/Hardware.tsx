import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type Manifest = Awaited<ReturnType<typeof api.packages>>;

export default function Hardware() {
  const [m, setM] = useState<Manifest | null>(null);

  useEffect(() => {
    api.packages().then(setM).catch(() => setM(null));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-3xl font-bold md:text-4xl">The capture hardware</h1>
      <p className="mt-3 max-w-2xl text-slate-400">
        A standardised <b>UniFi</b> stack, sized to your pitch. Cameras are PoE (one cable for
        power + data); the on-site rack records locally and runs first-pass AI before syncing to
        the cloud.
      </p>

      {!m ? (
        <p className="mt-8 text-slate-400">Loading packages…</p>
      ) : (
        <>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {m.packages.map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl border border-line bg-card p-5">
                <h2 className="font-semibold">{p.name}</h2>
                <p className="text-sm text-slate-400">{p.pitch} · {p.camera_count} cameras</p>
                <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm">
                  {p.capture.map((c) => (
                    <li key={c.model} className="flex justify-between gap-2 border-b border-line py-1">
                      <span>
                        {c.qty}× {c.name}
                        <span className="block text-xs text-slate-500">{c.role}</span>
                      </span>
                      <code className="shrink-0 text-xs text-slate-500">{c.model}</code>
                    </li>
                  ))}
                </ul>
                <Link to="/about" className="mt-5 rounded-lg bg-pitch py-2.5 text-center font-semibold text-emerald-950">
                  Request a quote
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-line bg-card p-4 text-sm text-slate-400">
            <b className="text-slate-200">Network coverage:</b> a single <b>U7 Pro Outdoor</b> AP
            covers 5- and 7-a-side pitches. For full 11-a-side, the standard is <b>2× U7 Pro
            Outdoor</b> (mounted at opposite ends) for reliable end-to-end WiFi&nbsp;7 backhaul of
            the cameras and the on-site sync agent.
          </div>

          <h2 className="mt-12 text-2xl font-bold">On-site rack (edge)</h2>
          <p className="mt-2 text-sm text-slate-400">
            The local brain: records everything, runs first-pass AI on the <b>AI Key</b>, and owns
            the secure cloud uplink.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {m.edge.map((d) => (
              <div key={d.device} className="rounded-xl border border-line bg-card p-4">
                <div className="flex items-center justify-between">
                  <b className="text-sm">{d.device}</b>
                  <code className="text-xs text-slate-500">{d.model}</code>
                </div>
                <p className="mt-1 text-xs text-slate-400">{d.role}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-pitch/40 bg-card p-6">
            <h3 className="font-semibold text-pitch">Edge-first, cloud-heavy</h3>
            <p className="mt-2 text-sm text-slate-400">
              We record and pre-process on-site, then sync only the useful clips + event metadata —
              we don't stream raw 4K to the cloud. That keeps bandwidth and GPU cost down, survives
              internet drops, and keeps raw footage of minors on-site by default.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
