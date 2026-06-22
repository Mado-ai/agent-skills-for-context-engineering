import type { Metadata } from "next";
import Link from "next/link";
import { Container, Section, Button, Eyebrow, Card } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { JsonLd } from "@/components/JsonLd";
import { services, stats, process, sectors } from "@/lib/site";
import { professionalServiceSchema } from "@/lib/seo";

export const metadata: Metadata = {
  description:
    "go overseas helps Canadian businesses and their owners expand into international markets — market entry strategy, partnerships, brand growth, and go-to-market execution. Strategy. Creativity. Growth.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={professionalServiceSchema()} />
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 bg-grid opacity-70" />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-blue/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-52 -left-40 h-[30rem] w-[30rem] rounded-full bg-green/15 blur-[120px]" />

        <Container className="relative grid items-center gap-12 py-24 sm:py-32 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <Eyebrow>International Growth for Canadian Business</Eyebrow>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Take your Canadian business{" "}
              <span className="text-gradient">overseas.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist">
              go overseas is a Canadian business-development and creative-growth firm. We
              help owners and founders pair rigorous strategy with bold creativity to cross
              borders and build real traction in new markets.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button href="/contact">Start a conversation</Button>
              <Button href="/services" variant="ghost">
                Explore services
              </Button>
            </div>
            <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-mist-dim">
              Strategy · Creativity · Growth
            </p>
          </div>

          <div className="relative hidden lg:block">
            <div className="relative mx-auto flex aspect-square max-w-sm items-center justify-center rounded-[2rem] border border-line bg-ink-800/50 glow">
              <div className="animate-float-slow">
                <LogoMark size={180} />
              </div>
              <div className="absolute bottom-6 left-6 right-6 rounded-2xl border border-line bg-ink-900/80 p-4 backdrop-blur">
                <p className="text-xs text-mist-dim">Live across</p>
                <p className="font-display text-2xl font-semibold">24+ markets</p>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Stats */}
      <section className="border-b border-line bg-ink-900">
        <Container className="grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="px-2 py-10 text-center">
              <div className="font-display text-4xl font-semibold text-gradient">{s.value}</div>
              <div className="mt-2 text-sm text-mist-dim">{s.label}</div>
            </div>
          ))}
        </Container>
      </section>

      {/* Services */}
      <Section>
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <Eyebrow>What we do</Eyebrow>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything between “we should expand” and a market that runs itself.
            </h2>
          </div>
          <Button href="/services" variant="ghost">
            All services →
          </Button>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {services.map((service) => (
            <Card key={service.id}>
              <h3 className="font-display text-xl font-semibold">{service.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-mist">{service.summary}</p>
              <ul className="mt-5 space-y-2">
                {service.points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-mist">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green" />
                    {p}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      {/* Process */}
      <section className="border-y border-line bg-ink-900">
        <Container className="py-20 sm:py-28">
          <Eyebrow>How we work</Eyebrow>
          <h2 className="mt-5 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            A four-phase path from ambition to autonomous growth.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {process.map((p) => (
              <div key={p.step} className="rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-6">
                <span className="font-display text-3xl font-semibold text-gradient">{p.step}</span>
                <h3 className="mt-4 font-display text-lg font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist-dim">{p.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Sectors */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <Eyebrow>Where we play</Eyebrow>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Sector depth, global reach.
            </h2>
            <p className="mt-5 max-w-md text-mist">
              We bring pattern recognition from dozens of cross-border launches — and the
              humility to learn what makes each market different.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {sectors.map((sector) => (
              <span
                key={sector}
                className="rounded-full border border-line bg-ink-800/60 px-5 py-2.5 text-sm text-mist"
              >
                {sector}
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* CTA */}
      <section className="border-t border-line">
        <Container className="py-20 sm:py-28">
          <div className="relative overflow-hidden rounded-[2rem] border border-line bg-gradient-to-br from-blue/15 via-ink-800 to-green/10 p-10 sm:p-16">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan/20 blur-[100px]" />
            <div className="relative max-w-2xl">
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Ready to go overseas?
              </h2>
              <p className="mt-4 text-lg text-mist">
                Tell us where you want to grow. We&apos;ll tell you what it takes — and how
                we&apos;d get you there.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/contact">Start a conversation</Button>
                <Link
                  href="/work"
                  className="inline-flex items-center px-2 py-3 text-sm font-semibold text-mist hover:text-white"
                >
                  See our work →
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
