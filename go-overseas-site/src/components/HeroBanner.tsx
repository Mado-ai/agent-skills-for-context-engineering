"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Container, Button, Eyebrow } from "@/components/ui";
import { WebGLShader } from "@/components/ui/web-gl-shader";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { Sparkle } from "@/components/BrandGraphics";
import type { Banner } from "@/lib/banners";

type Accent = NonNullable<Banner["accent"]>;
const PILL: Record<Accent, string> = {
  blue: "bg-blue/15 text-blue",
  purple: "bg-purple/15 text-purple",
  green: "bg-green/15 text-green",
  pink: "bg-pink/15 text-pink",
};
const DOT: Record<Accent, string> = {
  blue: "bg-blue",
  purple: "bg-purple",
  green: "bg-green",
  pink: "bg-pink",
};

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path
        d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rotating hero banner carousel — supports up to 4 banners. */
export function HeroBanner({ banners }: { banners: Banner[] }) {
  const items = banners.slice(0, 4);
  const count = items.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useRef(false);
  const startX = useRef(0);

  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (count <= 1 || paused || reduce.current) return;
    const id = setInterval(() => setIndex((p) => (p + 1) % count), 6500);
    return () => clearInterval(id);
  }, [count, paused]);

  const go = (n: number) => setIndex(((n % count) + count) % count);

  return (
    <section
      className="relative flex min-h-[38rem] items-center overflow-hidden border-b border-line lg:min-h-[34rem]"
      aria-roledescription="carousel"
      aria-label="Featured banners"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(e) => {
        startX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - startX.current;
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      {/* Animated shader background + legibility overlays */}
      <WebGLShader className="pointer-events-none absolute inset-0 block h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/50 via-transparent to-ink" />
      <Sparkle className="pointer-events-none absolute right-[12%] top-[16%] hidden h-28 w-28 text-blue/15 lg:block animate-twinkle" />

      <Container className="relative z-10 w-full py-20 sm:py-24">
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-700 ease-[cubic-bezier(0.65,0.05,0.2,1)]"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
          {items.map((b, idx) => {
            const active = idx === index;
            const accent = b.accent ?? "blue";
            return (
              <div
                key={b.id}
                aria-hidden={!active}
                aria-roledescription="slide"
                inert={active ? undefined : true}
                className="w-full shrink-0"
              >
                <div className="min-h-[19rem] max-w-2xl sm:min-h-[17rem]">
                {b.tag && (
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${PILL[accent]}`}
                  >
                    {b.tag}
                  </span>
                )}
                <div className={b.tag ? "mt-4" : ""}>
                  <Eyebrow>{b.eyebrow}</Eyebrow>
                </div>
                <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                  {b.title}
                  {b.highlight && (
                    <>
                      {" "}
                      <span className="text-gradient">{b.highlight}</span>
                    </>
                  )}
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist">{b.body}</p>
                {b.meta && <p className="mt-3 text-sm text-mist-dim">{b.meta}</p>}
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href={b.primary.href} aria-label={b.primary.label}>
                    <LiquidButton
                      size="xl"
                      className="rounded-full border border-white/30 text-white"
                    >
                      {b.primary.label}
                    </LiquidButton>
                  </Link>
                  {b.secondary && (
                    <Button href={b.secondary.href} variant="ghost">
                      {b.secondary.label}
                    </Button>
                  )}
                </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>

        {/* Controls */}
        {count > 1 && (
          <div className="mt-10 flex items-center gap-4">
            <div className="flex gap-2" role="tablist" aria-label="Choose banner">
              {items.map((b, idx) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => go(idx)}
                  aria-label={`Show banner ${idx + 1}`}
                  aria-current={idx === index}
                  className={`h-2 rounded-full transition-all ${
                    idx === index
                      ? `w-7 ${DOT[b.accent ?? "blue"]}`
                      : "w-2 bg-mist-dim/40 hover:bg-mist-dim"
                  }`}
                />
              ))}
            </div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => go(index - 1)}
                aria-label="Previous banner"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-mist transition-colors hover:border-mist-dim hover:text-white"
              >
                <Chevron dir="left" />
              </button>
              <button
                type="button"
                onClick={() => go(index + 1)}
                aria-label="Next banner"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-mist transition-colors hover:border-mist-dim hover:text-white"
              >
                <Chevron dir="right" />
              </button>
            </div>
          </div>
        )}
      </Container>
    </section>
  );
}
