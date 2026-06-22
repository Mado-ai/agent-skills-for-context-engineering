import type { Metadata } from "next";
import { Container, Section, Button, Eyebrow, Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Work — Cross-Border Growth Case Studies",
  description:
    "Selected cross-border growth engagements — international market entries, partnerships, and brand launches delivered by go overseas.",
  alternates: { canonical: "/work" },
};

const caseStudies = [
  {
    client: "Toronto-based SaaS scale-up",
    sector: "B2B SaaS",
    markets: "Japan & South Korea",
    headline: "From zero to CA$4.2M ARR in APAC in 14 months",
    body: "We helped a Canadian founder validate demand, secure two reseller partners, and localize positioning for enterprise buyers — landing the first ten logos ahead of plan.",
    metrics: [
      { value: "CA$4.2M", label: "New ARR" },
      { value: "14 mo", label: "To traction" },
      { value: "10", label: "Enterprise logos" },
    ],
  },
  {
    client: "Montréal D2C brand",
    sector: "Consumer",
    markets: "United States",
    headline: "A US launch that didn't flatten the brand",
    body: "Cross-cultural repositioning plus a creator-led campaign gave a beloved Canadian brand an authentic American voice — without diluting what made it special.",
    metrics: [
      { value: "3.1x", label: "Return on ad spend" },
      { value: "+68%", label: "Aided awareness" },
      { value: "90 days", label: "To first sales" },
    ],
  },
  {
    client: "Vancouver fintech firm",
    sector: "Fintech",
    markets: "Southeast Asia",
    headline: "Regulatory-first entry across three SEA markets",
    body: "We mapped licensing pathways, structured local partnerships, and built the GTM model for a Canadian owner-led simultaneous entry into Singapore, Indonesia, and the Philippines.",
    metrics: [
      { value: "3", label: "Markets at once" },
      { value: "5", label: "Strategic partners" },
      { value: "6 mo", label: "To first license" },
    ],
  },
];

export default function WorkPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <Container className="relative py-20 sm:py-28">
          <Eyebrow>Work</Eyebrow>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Markets entered. Traction proven.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-mist">
            A selection of cross-border engagements helping Canadian businesses grow abroad.
            Names are withheld under NDA — the results are not.
          </p>
        </Container>
      </section>

      <Section className="space-y-6">
        {caseStudies.map((cs) => (
          <Card key={cs.client} className="overflow-hidden p-0">
            <div className="grid gap-8 p-8 lg:grid-cols-[1.3fr_1fr] lg:p-10">
              <div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-line px-3 py-1 text-mist-dim">{cs.sector}</span>
                  <span className="rounded-full border border-line px-3 py-1 text-mist-dim">{cs.markets}</span>
                </div>
                <h2 className="mt-5 font-display text-2xl font-semibold leading-snug">{cs.headline}</h2>
                <p className="mt-3 leading-relaxed text-mist">{cs.body}</p>
                <p className="mt-5 text-sm font-medium text-mist-dim">— {cs.client}</p>
              </div>
              <div className="grid grid-cols-3 gap-px self-center overflow-hidden rounded-2xl border border-line lg:grid-cols-1">
                {cs.metrics.map((m) => (
                  <div key={m.label} className="bg-ink-900 p-5 text-center lg:text-left">
                    <div className="font-display text-2xl font-semibold text-gradient">{m.value}</div>
                    <div className="mt-1 text-xs text-mist-dim">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </Section>

      <section className="border-t border-line">
        <Container className="py-20 text-center sm:py-28">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Your market could be next.
          </h2>
          <div className="mt-8 flex justify-center">
            <Button href="/contact">Start a conversation</Button>
          </div>
        </Container>
      </section>
    </>
  );
}
