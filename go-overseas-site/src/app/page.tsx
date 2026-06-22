import type { Metadata } from "next";
import { Container, Section, Button, Eyebrow } from "@/components/ui";
import { Counter } from "@/components/Counter";
import { CtaBanner } from "@/components/CtaBanner";
import { ServiceCard } from "@/components/ServiceCard";
import { LogoMark } from "@/components/Logo";
import { JsonLd } from "@/components/JsonLd";
import { BrandBackdrop, Sparkle, GrowthArrow, LoopSquiggle, HalfRing } from "@/components/BrandGraphics";
import { HeroCanvas } from "@/components/HeroCanvas";
import { Magnetic } from "@/components/Magnetic";
import { Tilt } from "@/components/Tilt";
import { Reveal } from "@/components/Reveal";
import { services, stats, process, sectors } from "@/lib/site";
import { professionalServiceSchema } from "@/lib/seo";

const pillars = [
  {
    tag: "Strategy",
    word: "Think.",
    body: "Research. Planning. Positioning. Direction.",
    color: "text-blue",
    chip: "bg-blue/10",
    border: "border-blue/20",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    tag: "Creativity",
    word: "Create.",
    body: "Branding. Design. Content. Experiences.",
    color: "text-purple",
    chip: "bg-purple/10",
    border: "border-purple/20",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M12 19l7-7-4-4-7 7v4h4z" />
        <path d="M14 6l4 4" />
      </svg>
    ),
  },
  {
    tag: "Growth",
    word: "Grow.",
    body: "Ads. Marketing. Automation. Scale.",
    color: "text-green",
    chip: "bg-green/10",
    border: "border-green/20",
    icon: <GrowthArrow className="h-6 w-6" />,
  },
];

export const metadata: Metadata = {
  description:
    "go overseas is a creative management agency — brand identity, websites & apps, paid ads, PR, automation, and analytics. Strategy. Creativity. Growth.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={professionalServiceSchema()} />
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <BrandBackdrop />
        <HeroCanvas className="pointer-events-none absolute inset-0 h-full w-full opacity-70" />

        <Container className="relative grid items-center gap-12 py-24 sm:py-32 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <Eyebrow>Creative Management & Growth</Eyebrow>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              We build brands and the systems that{" "}
              <span className="text-gradient">grow them.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist">
              go overseas is a creative management agency. From brand identity and websites
              to ads, PR, and automation, we handle the strategy, the creative, and the
              execution that turn ambitious ideas into real traction.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Magnetic>
                <Button href="/contact">Start a conversation</Button>
              </Magnetic>
              <Magnetic>
                <Button href="/services" variant="ghost">
                  Explore services
                </Button>
              </Magnetic>
            </div>
            <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em]">
              <span className="text-blue">Strategy</span>{" "}
              <span className="text-mist-dim">·</span>{" "}
              <span className="text-purple">Creativity</span>{" "}
              <span className="text-mist-dim">·</span>{" "}
              <span className="text-green">Growth</span>
            </p>
          </div>

          <div className="relative hidden lg:block">
            {/* Signature blue sparkle framing the mark — straight from the brand cards */}
            <Sparkle className="pointer-events-none absolute inset-0 m-auto h-[32rem] w-[32rem] text-blue animate-spin-slow-rev" />
            <HalfRing className="pointer-events-none absolute right-4 top-2 h-24 w-24 text-pink" />
            <LoopSquiggle className="pointer-events-none absolute -bottom-1 left-2 h-12 w-32 text-lime" />
            <div className="relative mx-auto flex aspect-square max-w-[17rem] items-center justify-center rounded-full bg-ink-900 ring-1 ring-line">
              <div className="animate-float-slow text-white">
                <LogoMark size={148} />
              </div>
            </div>
            <div className="absolute bottom-0 right-0 rounded-2xl border border-line bg-ink-900/90 px-5 py-4 backdrop-blur">
              <p className="text-xs text-mist-dim">Trusted by</p>
              <p className="font-display text-2xl font-semibold">60+ brands</p>
            </div>
          </div>
        </Container>
      </section>

      {/* Stats */}
      <section className="border-b border-line bg-ink-900">
        <Container className="grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className="px-2 py-10 text-center">
              <div
                className={`font-display text-4xl font-semibold ${
                  ["text-blue", "text-green", "text-purple", "text-pink"][i % 4]
                }`}
              >
                <Counter value={s.value} />
              </div>
              <div className="mt-2 text-sm text-mist-dim">{s.label}</div>
            </div>
          ))}
        </Container>
      </section>

      {/* Pillars — Think · Create · Grow */}
      <section className="relative overflow-hidden border-b border-line">
        <GrowthArrow className="pointer-events-none absolute -right-6 top-10 h-40 w-40 text-green/10" />
        <Sparkle className="pointer-events-none absolute -left-10 bottom-4 h-32 w-32 text-pink/10" />
        <Container className="relative py-20 sm:py-28">
          <div className="text-center">
            <Eyebrow>Our pillars</Eyebrow>
            <h2 className="mx-auto mt-5 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              <span className="text-blue">Strategy.</span>{" "}
              <span className="text-purple">Creativity.</span>{" "}
              <span className="text-green">Growth.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-mist">
              Three disciplines, one system — how we turn ambitious ideas into
              measurable growth.
            </p>
          </div>
          <Reveal className="mt-12 grid gap-6 md:grid-cols-3">
            {pillars.map((p) => (
              <Tilt key={p.tag}>
                <div
                  className={`relative h-full overflow-hidden rounded-[var(--radius-card)] border ${p.border} bg-ink-800/40 p-8`}
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${p.chip} ${p.color}`}>
                    {p.icon}
                  </div>
                  <p className={`mt-6 font-display text-3xl font-semibold ${p.color}`}>{p.word}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-mist-dim">
                    {p.tag}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-mist">{p.body}</p>
                </div>
              </Tilt>
            ))}
          </Reveal>
        </Container>
      </section>

      {/* Services */}
      <Section>
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <Eyebrow>What we do</Eyebrow>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything your brand needs, under one roof.
            </h2>
            <LoopSquiggle className="mt-3 h-7 w-28 text-lime" />
          </div>
          <Button href="/services" variant="ghost">
            All services →
          </Button>
        </div>

        <Reveal className="mt-12 grid gap-6 md:grid-cols-2">
          {services.map((service) => (
            <Tilt key={service.id}>
              <ServiceCard service={service} />
            </Tilt>
          ))}
        </Reveal>
      </Section>

      {/* Process — bold colour block */}
      <section className="relative overflow-hidden bg-gradient-to-br from-purple via-blue-deep to-blue">
        <Sparkle className="pointer-events-none absolute -left-12 -top-12 h-56 w-56 text-white/10 animate-spin-slow" />
        <LoopSquiggle className="pointer-events-none absolute right-10 top-12 hidden h-12 w-32 text-white/30 sm:block" />
        <Container className="relative py-20 sm:py-28">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            How we work
          </span>
          <h2 className="mt-5 max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            From idea to impact — a four-step path.
          </h2>
          <Reveal className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {process.map((p) => (
              <div
                key={p.step}
                className="rounded-[var(--radius-card)] border border-white/15 bg-white/10 p-6 backdrop-blur"
              >
                <span className="font-display text-3xl font-semibold text-white">{p.step}</span>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/80">{p.body}</p>
              </div>
            ))}
          </Reveal>
        </Container>
      </section>

      {/* Sectors */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <Eyebrow>Who we work with</Eyebrow>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Built for brands across every space.
            </h2>
            <p className="mt-5 max-w-md text-mist">
              We bring pattern recognition from dozens of brands and campaigns — and the
              curiosity to learn what makes yours different.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {sectors.map((sector, i) => {
              const c = [
                { border: "border-blue/40", dot: "bg-blue" },
                { border: "border-green/40", dot: "bg-green" },
                { border: "border-purple/40", dot: "bg-purple" },
                { border: "border-pink/40", dot: "bg-pink" },
                { border: "border-cyan/40", dot: "bg-cyan" },
                { border: "border-lime/40", dot: "bg-lime" },
              ][i % 6];
              return (
                <span
                  key={sector}
                  className={`inline-flex items-center gap-2.5 rounded-full border ${c.border} bg-ink-800/60 px-5 py-2.5 text-sm text-mist transition-colors hover:bg-ink-800`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                  {sector}
                </span>
              );
            })}
          </div>
        </div>
      </Section>

      <CtaBanner
        title="Ready to grow your brand?"
        body="Tell us what you're building. We'll show you how we'd bring the strategy, creativity, and growth to make it happen."
        secondaryHref="/work"
        secondaryLabel="See our work"
      />
    </>
  );
}
