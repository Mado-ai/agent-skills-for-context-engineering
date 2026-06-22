"use client";

import { useState } from "react";
import { clients, kpis, traffic, sources, leads, keywords, revenue, type Accent } from "@/lib/portal-mock";

const TEXT: Record<Accent, string> = { blue: "text-blue", purple: "text-purple", green: "text-green" };
const STROKE: Record<Accent, string> = { blue: "#00aeef", purple: "#6c3ef4", green: "#32c46a" };
const BG: Record<Accent, string> = { blue: "bg-blue", purple: "bg-purple", green: "bg-green" };
const PLAN_STYLE: Record<string, string> = {
  Essential: "bg-mist-dim/20 text-mist",
  Growth: "bg-blue/15 text-blue",
  Performance: "bg-green/15 text-green",
};

/** Build a smooth-ish SVG path from numbers, normalized into a w×h box. */
function path(points: number[], w: number, h: number, pad = 2) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  return points
    .map((p, i) => {
      const x = pad + i * step;
      const y = h - pad - ((p - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function Spark({ points, color }: { points: number[]; color: string }) {
  return (
    <svg viewBox="0 0 80 26" className="h-7 w-20" fill="none" preserveAspectRatio="none">
      <path d={path(points, 80, 26)} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AreaChart({ points, color }: { points: number[]; color: string }) {
  const w = 600;
  const h = 180;
  const line = path(points, w, h, 4);
  const area = `${line} L${w - 4} ${h - 4} L4 ${h - 4} Z`;
  const id = `area-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full" fill="none" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TABS = ["Overview", "Traffic", "Leads", "SEO", "Revenue"] as const;

export function PortalDemo() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [client, setClient] = useState(clients[0]);

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-900 shadow-2xl shadow-black/40">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-line bg-ink-800/60 px-4 py-3">
        <img src="/mark-dark.png" alt="" width={26} height={22} style={{ height: 22, width: 26 }} />
        <span className="hidden text-sm font-semibold sm:inline">Client portal</span>
        <span className="mx-1 hidden h-4 w-px bg-line sm:inline-block" />
        <div className="flex items-center gap-2">
          <select
            aria-label="Switch client"
            value={client.name}
            onChange={(e) => setClient(clients.find((c) => c.name === e.target.value) ?? clients[0])}
            className="rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 text-sm font-semibold text-white focus:border-blue focus:outline-none"
          >
            {clients.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${PLAN_STYLE[client.plan]}`}>
            {client.plan}
          </span>
        </div>
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-green sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-green" /> Live
        </span>
      </div>

      {/* Tabs */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative whitespace-nowrap px-3.5 py-3 text-sm font-medium transition-colors ${
              tab === t ? "text-white" : "text-mist hover:text-white"
            }`}
          >
            {t}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-5 sm:p-6">
        {tab === "Overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-xl border border-line bg-ink-800/50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-mist-dim">{k.label}</span>
                    <Spark points={k.spark} color={STROKE[k.accent]} />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className={`font-display text-2xl font-semibold ${TEXT[k.accent]}`}>{k.value}</span>
                    <span className={`text-xs font-semibold ${k.up ? "text-green" : "text-red-400"}`}>{k.delta}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="rounded-xl border border-line bg-ink-800/50 p-5">
                <p className="text-sm font-semibold">Traffic — last 30 days</p>
                <AreaChart points={traffic} color={STROKE.blue} />
              </div>
              <div className="rounded-xl border border-line bg-ink-800/50 p-5">
                <p className="text-sm font-semibold">Recent leads</p>
                <ul className="mt-3 space-y-3">
                  {leads.slice(0, 4).map((l) => (
                    <li key={l.name} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        <span className="font-medium text-white">{l.name}</span>
                        <span className="block text-xs text-mist-dim">{l.detail}</span>
                      </span>
                      <span className="shrink-0 text-xs text-mist-dim">{l.time}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {tab === "Traffic" && (
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border border-line bg-ink-800/50 p-5">
              <p className="text-sm font-semibold">Sessions — last 30 days</p>
              <AreaChart points={traffic} color={STROKE.blue} />
            </div>
            <div className="rounded-xl border border-line bg-ink-800/50 p-5">
              <p className="text-sm font-semibold">Sources</p>
              <ul className="mt-4 space-y-3">
                {sources.map((s) => (
                  <li key={s.label}>
                    <div className="flex justify-between text-sm">
                      <span className="text-mist">{s.label}</span>
                      <span className="font-medium text-white">{s.pct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
                      <div className={`h-full rounded-full ${BG[s.accent]}`} style={{ width: `${s.pct}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === "Leads" && (
          <div className="overflow-hidden rounded-xl border border-line">
            {leads.map((l) => (
              <div key={l.name} className="flex items-center justify-between gap-3 border-b border-line bg-ink-800/40 px-4 py-3 text-sm last:border-0">
                <span>
                  <span className="font-medium text-white">{l.name}</span>
                  <span className="block text-xs text-mist-dim">{l.detail}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="hidden text-xs text-mist-dim sm:inline">{l.time}</span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      l.status === "New"
                        ? "bg-blue/15 text-blue"
                        : l.status === "Won"
                          ? "bg-green/15 text-green"
                          : "bg-mist-dim/20 text-mist"
                    }`}
                  >
                    {l.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "SEO" && (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-line bg-ink-800/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-mist-dim">
              <span>Keyword</span>
              <span className="text-right">Position</span>
              <span className="text-right">Change</span>
            </div>
            {keywords.map((k) => (
              <div key={k.kw} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line bg-ink-800/40 px-4 py-3 text-sm last:border-0">
                <span className="text-white">{k.kw}</span>
                <span className="text-right font-medium text-white">#{k.pos}</span>
                <span className={`text-right text-xs font-semibold ${k.change >= 0 ? "text-green" : "text-red-400"}`}>
                  {k.change >= 0 ? `▲ ${k.change}` : `▼ ${Math.abs(k.change)}`}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "Revenue" && (
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border border-line bg-ink-800/50 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">CorePay revenue — 12 months</p>
                <span className="rounded-md bg-green/15 px-2 py-0.5 text-[11px] font-semibold text-green">via CorePay</span>
              </div>
              <AreaChart points={revenue} color={STROKE.green} />
            </div>
            <div className="rounded-xl border border-line bg-ink-800/50 p-5">
              <p className="text-sm font-semibold">This month</p>
              <p className="mt-3 font-display text-4xl font-semibold text-green">$18.2k</p>
              <p className="mt-1 text-xs text-mist-dim">+21% vs. last month</p>
              <p className="mt-5 text-sm leading-relaxed text-mist">
                Your website traffic and your CorePay revenue, side by side — the one view Wix and
                Webflow can&apos;t show.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
