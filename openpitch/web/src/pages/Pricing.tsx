import { Link } from "react-router-dom";

const TIERS = [
  {
    name: "Starter",
    price: "5-a-side",
    note: "Single small pitch",
    features: ["AI Pro 4K + G5 PTZ + Bullet", "Pitch-side WiFi", "Edge recording + secure sync", "Cloud analysis & highlights"],
    cta: "Request a quote",
    to: "/about",
    highlight: false,
  },
  {
    name: "Growth",
    price: "7-a-side",
    note: "Most academies start here",
    features: ["Everything in Starter", "+ sideline G5 Pro 4K", "Clubhouse WiFi", "Multi-angle review"],
    cta: "Request a quote",
    to: "/about",
    highlight: true,
  },
  {
    name: "Pro",
    price: "11-a-side",
    note: "Full pitch, multi-pitch ready",
    features: ["Everything in Growth", "2× sideline 4K (multi-angle)", "RAID recording + UPS", "Priority GPU + API access"],
    cta: "Request a quote",
    to: "/about",
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-center text-3xl font-bold md:text-4xl">Packages</h1>
      <p className="mt-3 text-center text-slate-400">
        Three UniFi-based capture packages, sized to your pitch. Pricing is configured per deployment.
      </p>

      <div className="mt-8 flex flex-col items-center justify-between gap-3 rounded-2xl border border-pitch/40 bg-card p-5 sm:flex-row">
        <div>
          <b className="text-pitch">No hardware yet? Try Solo Mode — free.</b>
          <p className="text-sm text-slate-400">Film on your phone and build a player profile, no facility rig required.</p>
        </div>
        <Link to="/?signup" className="shrink-0 rounded-lg bg-pitch px-5 py-2.5 font-semibold text-emerald-950">
          Start free
        </Link>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`flex flex-col rounded-2xl border bg-card p-6 ${
              t.highlight ? "border-pitch ring-1 ring-pitch" : "border-line"
            }`}
          >
            {t.highlight && (
              <span className="mb-2 w-fit rounded-full bg-pitch px-2.5 py-0.5 text-xs font-semibold text-emerald-950">
                Most popular
              </span>
            )}
            <h2 className="font-semibold">{t.name}</h2>
            <p className="mt-1 text-sm text-slate-400">{t.note}</p>
            <div className="mt-4">
              <span className="text-2xl font-bold">{t.price}</span>
            </div>
            <ul className="mt-5 flex flex-1 flex-col gap-2 text-sm">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-pitch">✓</span>
                  <span className="text-slate-300">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              to={t.to}
              className={`mt-6 rounded-lg py-2.5 text-center font-semibold ${
                t.highlight ? "bg-pitch text-emerald-950" : "bg-line text-white"
              }`}
            >
              {t.cta}
            </Link>
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-slate-500">
        Prototype pricing for demonstration — no billing is wired up.
      </p>
    </div>
  );
}
