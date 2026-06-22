import type { Metadata } from "next";
import { Container, Section, Button, Eyebrow, Card } from "@/components/ui";
import { BrandBackdrop } from "@/components/BrandGraphics";

export const metadata: Metadata = {
  title: "Work — Selected Projects & Case Studies",
  description:
    "Selected projects — brand identity, websites and apps, ad campaigns, PR, and automation delivered by go overseas.",
  alternates: { canonical: "/work" },
};

const caseStudies = [
  {
    client: "D2C skincare brand",
    sector: "Retail & E-commerce",
    services: "Brand · Web · Ads",
    headline: "A rebrand that doubled online conversion",
    body: "A full brand refresh, a new Shopify storefront, and a Meta + TikTok ad engine turned a struggling product line into a repeat-purchase favourite.",
    metrics: [
      { value: "2.1x", label: "Conversion rate" },
      { value: "+140%", label: "Online revenue" },
      { value: "3 mo", label: "To payback" },
    ],
  },
  {
    client: "Restaurant group",
    sector: "Hospitality & Food",
    services: "Brand · PR · Events",
    headline: "From quiet opening to fully booked",
    body: "Identity, website, launch events, and a local PR plus paid-social push filled tables within weeks — and built a community that keeps coming back.",
    metrics: [
      { value: "+90%", label: "Covers per week" },
      { value: "25K", label: "New followers" },
      { value: "6", label: "Launch events" },
    ],
  },
  {
    client: "B2B services firm",
    sector: "Professional Services",
    services: "Automation · CRM · Reporting",
    headline: "Automation that freed 20 hours a week",
    body: "We documented SOPs, designed a client database, and automated intake and reporting — cutting busywork and tripling qualified leads.",
    metrics: [
      { value: "20 hrs", label: "Saved per week" },
      { value: "3x", label: "Qualified leads" },
      { value: "1", label: "Unified system" },
    ],
  },
];

export default function WorkPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <BrandBackdrop />
        <Container className="relative py-20 sm:py-28">
          <Eyebrow>Work</Eyebrow>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Brands built. Results proven.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-mist">
            A selection of projects across brand, web, advertising, and operations.
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
                  <span className="rounded-full border border-line px-3 py-1 text-mist-dim">{cs.services}</span>
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
            Your brand could be next.
          </h2>
          <div className="mt-8 flex justify-center">
            <Button href="/contact">Start a conversation</Button>
          </div>
        </Container>
      </section>
    </>
  );
}
