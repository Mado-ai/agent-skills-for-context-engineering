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
import { Parallax } from "@/components/Parallax";
import { TextReveal } from "@/components/TextReveal";
import { PinnedSteps } from "@/components/PinnedSteps";
import { HorizontalStrip } from "@/components/HorizontalStrip";
import { services, stats, process, sectors } from "@/lib/site";
import { everySite } from "@/lib/pricing";
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
            <TextReveal
              as="h1"
              className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
              words={[
                { t: "We" },
                { t: "build" },
                { t: "brands" },
                { t: "and" },
                { t: "the" },
                { t: "systems" },
                { t: "that" },
                { t: "grow", className: "text-gradient" },
                { t: "them.", className: "text-gradient" },
              ]}
            />
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

          <Parallax speed={0.06} className="relative hidden lg:block">
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
          </Parallax>
        </Container>
        <div className="pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center lg:flex">
          <span className="flex flex-col items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-mist-dim">
            Scroll
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-bob">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
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

      {/* Websites offer teaser — horizontal strip */}
      <Section>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Websites that sell</Eyebrow>
          <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            A complete website from <span className="text-blue">$999</span>.
          </h2>
          <p className="mt-4 text-mist">
            Every site ships ready to rank and convert — then we keep it that way on a simple
            monthly care plan. No separate hosting bill, ever.
          </p>
        </div>
        <div className="mt-10">
          <HorizontalStrip>
            {everySite.map((item) => (
              <div
                key={item}
                className="flex min-w-[230px] snap-start items-start gap-3 rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-6"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  className="mt-0.5 h-5 w-5 shrink-0 text-green"
                >
                  <path d="M5 13l4 4 10-11" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-sm font-medium text-white">{item}</span>
              </div>
            ))}
          </HorizontalStrip>
        </div>
        <div className="mt-8 flex justify-center">
          <Magnetic>
            <Button href="/pricing">See plans &amp; pricing</Button>
          </Magnetic>
        </div>
      </Section>

      {/* Process — pinned narrative */}
      <PinnedSteps
        steps={process}
        eyebrow="How we work"
        title="From idea to impact — a four-step path."
      />

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
