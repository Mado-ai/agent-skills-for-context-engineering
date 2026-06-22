"use client";

import { useEffect, useRef, useState } from "react";
import { Container } from "./ui";
import { Sparkle, LoopSquiggle } from "./BrandGraphics";

type Step = { step: string; title: string; body: string };

/**
 * Pinned narrative: on large screens the section pins while the active step
 * advances with scroll and a progress rail fills. On small screens / reduced
 * motion it's a normal stacked grid — the content is always fully visible.
 */
export function PinnedSteps({
  steps,
  eyebrow,
  title,
}: {
  steps: readonly Step[];
  eyebrow: string;
  title: string;
}) {
  const outer = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const pinnedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      const on = mq.matches && !reduced.matches;
      pinnedRef.current = on;
      setPinned(on);
      if (!on) {
        setActive(0);
        setProgress(0);
      }
    };
    apply();

    let raf = 0;
    const onScroll = () => {
      if (!pinnedRef.current || !outer.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = outer.current!;
        const total = el.offsetHeight - window.innerHeight;
        const p = total > 0 ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total)) : 0;
        setProgress(p);
        setActive(Math.min(steps.length - 1, Math.floor(p * steps.length)));
      });
    };

    mq.addEventListener("change", apply);
    reduced.addEventListener("change", apply);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      mq.removeEventListener("change", apply);
      reduced.removeEventListener("change", apply);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [steps.length]);

  return (
    <section
      ref={outer}
      className="relative overflow-hidden bg-gradient-to-br from-purple via-blue-deep to-blue"
      style={pinned ? { height: `${(steps.length + 1) * 100}vh` } : undefined}
    >
      <Sparkle className="pointer-events-none absolute -left-12 -top-12 h-56 w-56 text-white/10 animate-spin-slow" />
      <LoopSquiggle className="pointer-events-none absolute right-10 top-12 hidden h-12 w-32 text-white/30 sm:block" />
      <div className={pinned ? "sticky top-0 flex h-screen flex-col justify-center" : ""}>
        <Container className="py-20 sm:py-28">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            {eyebrow}
          </span>
          <h2 className="mt-5 max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {title}
          </h2>

          {/* Progress rail (desktop pinned) */}
          {pinned && (
            <div className="mt-8 h-0.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((p, i) => {
              const isActive = pinned && i === active;
              return (
                <div
                  key={p.step}
                  className={`rounded-[var(--radius-card)] border p-6 transition-all duration-300 ${
                    isActive
                      ? "border-white/40 bg-white/20 lg:-translate-y-1.5"
                      : "border-white/15 bg-white/10"
                  } ${pinned && !isActive ? "lg:opacity-60" : ""} backdrop-blur`}
                >
                  <span className="font-display text-3xl font-semibold text-white">{p.step}</span>
                  <h3 className="mt-4 font-display text-lg font-semibold text-white">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/80">{p.body}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </div>
    </section>
  );
}
