"use client";

import { useState } from "react";
import { Button } from "./ui";
import { Counter } from "./Counter";
import { plans, type Plan } from "@/lib/pricing";

const ACCENT: Record<Plan["accent"], { text: string; ring: string; dot: string }> = {
  blue: { text: "text-blue", ring: "ring-blue/50", dot: "bg-blue" },
  purple: { text: "text-purple", ring: "ring-purple/60", dot: "bg-purple" },
  green: { text: "text-green", ring: "ring-green/50", dot: "bg-green" },
};

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className={className}>
      <path d="M5 13l4 4 10-11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Pricing() {
  const [mode, setMode] = useState<"build" | "care">("build");

  return (
    <div>
      {/* Build / Care toggle */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border border-line bg-ink-800/60 p-1">
          {(["build", "care"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                mode === m ? "bg-blue text-white" : "text-mist hover:text-white"
              }`}
            >
              {m === "build" ? "Build (one-time)" : "Care plan (monthly)"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const a = ACCENT[plan.accent];
          const includes = mode === "build" ? plan.buildIncludes : plan.careIncludes;
          const price = mode === "build" ? plan.build : plan.care;
          return (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-8 ${
                plan.popular ? `ring-2 ${a.ring} lg:-mt-3 lg:mb-3` : ""
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-8 rounded-full bg-purple px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${a.dot}`} />
                <h3 className="font-display text-lg font-semibold">
                  {mode === "build" ? plan.name : plan.careName}
                </h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-mist">{plan.description}</p>

              <div className="mt-6 flex items-end gap-1">
                {mode === "build" && <span className="mb-1 text-sm text-mist-dim">from</span>}
                <span className={`font-display text-5xl font-semibold ${a.text}`}>
                  $<Counter key={`${plan.name}-${mode}`} value={String(price)} />
                </span>
                <span className="mb-1.5 text-sm text-mist-dim">
                  {mode === "build" ? "one-time" : "/mo"}
                </span>
              </div>

              <div className="mt-6">
                <Button href="/contact" variant={plan.popular ? "primary" : "ghost"} className="w-full">
                  {mode === "build" ? plan.buttonText : `Choose ${plan.careName}`}
                </Button>
              </div>

              <ul className="mt-8 space-y-3 border-t border-line pt-6">
                {includes.map((item) =>
                  item.endsWith(":") ? (
                    <li key={item} className="text-xs font-semibold uppercase tracking-[0.14em] text-mist-dim">
                      {item}
                    </li>
                  ) : (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-mist">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${a.text}`} />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-sm text-mist-dim">
        Every website — including the $999 Starter — ships with a lead form, Terms &amp; Privacy
        pages, and full SEO. Hosting is always bundled into your care plan.
      </p>
    </div>
  );
}
