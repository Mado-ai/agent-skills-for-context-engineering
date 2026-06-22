import type { Metadata } from "next";
import { Container, Section, Button, Eyebrow, Card } from "@/components/ui";
import { services, process } from "@/lib/site";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Market entry, partnerships, brand & creative growth, and go-to-market execution for companies expanding overseas.",
};

export default function ServicesPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <Container className="relative py-20 sm:py-28">
          <Eyebrow>Services</Eyebrow>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            One partner for the whole journey across borders.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-mist">
            Most firms hand you a strategy and walk away. We stay — from the first market
            assessment through to signed partners and a live pipeline.
          </p>
        </Container>
      </section>

      <Section>
        <div className="grid gap-6 lg:grid-cols-2">
          {services.map((service) => (
            <Card key={service.id} className="scroll-mt-24">
              <div id={service.id} />
              <h2 className="font-display text-2xl font-semibold">{service.title}</h2>
              <p className="mt-3 leading-relaxed text-mist">{service.summary}</p>
              <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
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

      <section className="border-y border-line bg-ink-900">
        <Container className="py-20 sm:py-28">
          <Eyebrow>Engagement model</Eyebrow>
          <h2 className="mt-5 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Diagnose, design, deploy, scale.
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

      <Section className="text-center">
        <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Not sure where to start?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-mist">
          A 30-minute conversation is usually enough to tell whether a market is worth your
          time — and worth ours.
        </p>
        <div className="mt-8 flex justify-center">
          <Button href="/contact">Book an intro call</Button>
        </div>
      </Section>
    </>
  );
}
