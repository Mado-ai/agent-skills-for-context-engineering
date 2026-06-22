import type { Metadata } from "next";
import { Container, Section, Button, Eyebrow, Card } from "@/components/ui";
import { stats } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "go overseas is a cross-border growth firm built on three principles: strategy, creativity, and growth.",
};

const values = [
  {
    title: "Strategy",
    body: "We start with evidence, not optimism. Every recommendation traces back to data, risk, and a clear path to return.",
  },
  {
    title: "Creativity",
    body: "Markets reward the memorable. We bring creative firepower so you don't just enter a market — you stand out in it.",
  },
  {
    title: "Growth",
    body: "We measure ourselves on traction. Revenue, partners, and pipeline — not slide decks.",
  },
];

const team = [
  { name: "Founders with operator scars", role: "Built and exited companies in 3 continents" },
  { name: "Local market specialists", role: "On-the-ground partners in every region we serve" },
  { name: "Creative & brand talent", role: "Designers and strategists who think globally" },
];

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue/15 blur-[120px]" />
        <Container className="relative py-20 sm:py-28">
          <Eyebrow>About</Eyebrow>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            We exist to make crossing borders feel less like a leap.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-mist">
            go overseas was founded on a simple frustration: international expansion is
            treated as a side project, handed to a junior team or an absent consultant.
            We built a firm that treats it as the high-stakes, high-reward bet it actually is.
          </p>
        </Container>
      </section>

      <Section>
        <Eyebrow>What we believe</Eyebrow>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {values.map((v) => (
            <Card key={v.title}>
              <h3 className="font-display text-xl font-semibold text-gradient">{v.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-mist">{v.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <section className="border-y border-line bg-ink-900">
        <Container className="grid grid-cols-2 gap-px py-4 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="px-2 py-10 text-center">
              <div className="font-display text-4xl font-semibold text-gradient">{s.value}</div>
              <div className="mt-2 text-sm text-mist-dim">{s.label}</div>
            </div>
          ))}
        </Container>
      </section>

      <Section>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Eyebrow>Who we are</Eyebrow>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Operators, not just advisors.
            </h2>
            <p className="mt-5 max-w-md text-mist">
              Our team has launched products, signed distributors, and built local teams in
              markets across Asia, Europe, and the Americas. We&apos;ve made the mistakes so
              you don&apos;t have to.
            </p>
          </div>
          <div className="grid gap-4">
            {team.map((t) => (
              <div key={t.name} className="flex items-start gap-4 rounded-2xl border border-line bg-ink-800/50 p-5">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-r from-blue to-green" />
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm text-mist-dim">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <section className="border-t border-line">
        <Container className="py-20 text-center sm:py-28">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Let&apos;s build your next market together.
          </h2>
          <div className="mt-8 flex justify-center">
            <Button href="/contact">Start a conversation</Button>
          </div>
        </Container>
      </section>
    </>
  );
}
