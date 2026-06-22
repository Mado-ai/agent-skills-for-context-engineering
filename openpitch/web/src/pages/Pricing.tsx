import { Link } from "react-router-dom";

const TIERS = [
  {
    name: "Starter",
    price: "Free",
    note: "For trying it out",
    features: ["Synthetic demo clips", "Colour detector", "Possession + heatmaps", "1 saved analysis"],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Club",
    price: "$49",
    unit: "/mo",
    note: "For a single team",
    features: [
      "Upload your own matches",
      "YOLO real-footage detector",
      "Full analytics + auto highlights",
      "Unlimited analyses",
      "Player physical reports",
    ],
    cta: "Choose Club",
    highlight: true,
  },
  {
    name: "Academy",
    price: "Custom",
    note: "For multi-team organisations",
    features: ["Everything in Club", "Multiple teams & seats", "Priority GPU processing", "API access", "SSO & support"],
    cta: "Contact sales",
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-center text-3xl font-bold md:text-4xl">Simple pricing</h1>
      <p className="mt-3 text-center text-slate-400">Start free. Upgrade when you bring your own footage.</p>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
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
              <span className="text-3xl font-bold">{t.price}</span>
              {t.unit && <span className="text-slate-400">{t.unit}</span>}
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
              to="/"
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
