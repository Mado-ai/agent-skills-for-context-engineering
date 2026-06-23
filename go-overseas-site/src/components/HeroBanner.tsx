"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Container, Button, Eyebrow } from "@/components/ui";
import { WebGLShader } from "@/components/ui/web-gl-shader";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { Sparkle } from "@/components/BrandGraphics";
import type { Banner } from "@/lib/banners";

const AUTOPLAY = 6500;

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

/** Rotating hero banner carousel — up to 4 banners, horizontal slide, optional per-banner photo. */
export function HeroBanner({ banners }: { banners: Banner[] }) {
  const items = banners.slice(0, 4);
  const count = items.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const startX = useRef(0);

  useEffect(() => {
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (count <= 1 || paused || reduceMotion) return;
    const id = setInterval(() => setIndex((p) => (p + 1) % count), AUTOPLAY);
    return () => clearInterval(id);
  }, [count, paused, reduceMotion, index]);

  const go = (n: number) => setIndex(((n % count) + count) % count);
  const activeAccent = items[index]?.accent ?? "blue";

  return (
    <section
      className="relative min-h-[40rem] overflow-hidden border-b border-line bg-ink lg:min-h-[36rem]"
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
      {/* Shared animated shader (shows for banners without an image) */}
      <WebGLShader className="pointer-events-none absolute inset-0 block h-full w-full" />
      {/* Section legibility overlays (cover shader slides + the controls area) */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/40 via-transparent to-ink" />

      {/* Sliding track */}
      <div
        className="absolute inset-0 z-[1] flex transition-transform duration-700 ease-[cubic-bezier(0.65,0.05,0.2,1)]"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {items.map((b, idx) => {
          const active = idx === index;
          const accent = b.accent ?? "blue";
          return (
            <div
              key={b.id}
              className="relative flex h-full w-full shrink-0 items-center"
              aria-roledescription="slide"
              aria-hidden={!active}
              inert={active ? undefined : true}
            >
              {/* Per-banner background photo (replaces the shader for this slide) */}
              {b.image && (
                <>
                  <div className="absolute inset-0 bg-gradient-to-br from-ink-800 via-ink to-blue/15" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={b.image.src}
                    alt={b.image.alt ?? ""}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading={idx === 0 ? "eager" : "lazy"}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/40" />
                  <div className="absolute inset-0 bg-gradient-to-b from-ink/30 via-transparent to-ink" />
                </>
              )}
              <Sparkle className="pointer-events-none absolute right-[12%] top-[16%] hidden h-28 w-28 text-blue/15 lg:block animate-twinkle" />

              <Container className="relative z-10 w-full py-20 sm:py-24">
                <div className="max-w-2xl">
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
                  {(() => {
                    const cls =
                      "mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl";
                    const content = (
                      <>
                        {b.title}
                        {b.highlight && (
                          <>
                            {" "}
                            <span className="text-gradient">{b.highlight}</span>
                          </>
                        )}
                      </>
                    );
                    // Only the visible slide carries the page <h1>; the rest use <p>.
                    return active ? (
                      <h1 className={cls}>{content}</h1>
                    ) : (
                      <p className={cls}>{content}</p>
                    );
                  })()}
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
              </Container>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-8 z-20">
          <Container>
            <div className="flex items-center gap-4">
              <div>
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
                {/* Autoplay progress */}
                {!reduceMotion && (
                  <div className="mt-2.5 h-[3px] w-32 overflow-hidden rounded-full bg-white/15">
                    <div
                      key={index}
                      className={`hb-progress h-full rounded-full ${DOT[activeAccent]}`}
                      style={{ animationDuration: `${AUTOPLAY}ms`, animationPlayState: paused ? "paused" : "running" }}
                    />
                  </div>
                )}
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => go(index - 1)}
                  aria-label="Previous banner"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-ink/40 text-mist backdrop-blur transition-colors hover:border-mist-dim hover:text-white"
                >
                  <Chevron dir="left" />
                </button>
                <button
                  type="button"
                  onClick={() => go(index + 1)}
                  aria-label="Next banner"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-ink/40 text-mist backdrop-blur transition-colors hover:border-mist-dim hover:text-white"
                >
                  <Chevron dir="right" />
                </button>
              </div>
            </div>
          </Container>
        </div>
      )}
    </section>
  );
}
