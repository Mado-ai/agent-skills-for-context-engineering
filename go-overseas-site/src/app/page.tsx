import type { Metadata } from "next";
import { Container, Section, Button, Eyebrow } from "@/components/ui";
import { Counter } from "@/components/Counter";
import { CtaBanner } from "@/components/CtaBanner";
import { ServiceCard } from "@/components/ServiceCard";
import { HeroBanner } from "@/components/HeroBanner";
import { JsonLd } from "@/components/JsonLd";
import { Sparkle, GrowthArrow, LoopSquiggle } from "@/components/BrandGraphics";
import { Magnetic } from "@/components/Magnetic";
import { Tilt } from "@/components/Tilt";
import { Reveal } from "@/components/Reveal";
import { PinnedSteps } from "@/components/PinnedSteps";
import { HorizontalStrip } from "@/components/HorizontalStrip";
import { services, stats, process, sectors } from "@/lib/site";
import { everySite } from "@/lib/pricing";
import { banners } from "@/lib/banners";
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
      {/* Hero — rotating banner carousel (up to 4 banners) */}
      <HeroBanner banners={banners} />

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
