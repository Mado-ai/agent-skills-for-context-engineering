import type { Metadata } from "next";
import { Container, Section, Eyebrow } from "@/components/ui";
import { BrandBackdrop } from "@/components/BrandGraphics";
import { Pricing } from "@/components/Pricing";
import { CtaBanner } from "@/components/CtaBanner";
import { faqSchema } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

export const metadata: Metadata = {
  title: "Pricing — Websites from $999 + Care Plans",
  description:
    "A complete, SEO-ready website from $999, then a $49–$149/mo care plan that keeps it hosted, updated, and ranking. Transparent website pricing for small businesses.",
  alternates: { canonical: "/pricing" },
};

const faqs = [
  {
    q: "What's included in the $999 Starter?",
    a: "A complete multi-page website (up to 5 pages) with a lead-generation form, Terms & Conditions and Privacy Policy pages, full on-page SEO, and Google Business setup — a real, rankable business site, not a one-pager.",
  },
  {
    q: "Do I pay separately for hosting?",
    a: "No. Hosting, SSL, and backups are always bundled into your monthly care plan — you never get a separate hosting bill.",
  },
  {
    q: "What does the care plan do?",
    a: "It keeps your site fast, secure, and ranking: managed hosting, monitoring, updates, monthly content edits, and SEO. The Growth and Performance plans add reporting and a client dashboard.",
  },
  {
    q: "Can I start small and upgrade later?",
    a: "Yes. Most businesses start on Starter or Growth and move up as they grow. You can change your care plan at any time.",
  },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd data={faqSchema(faqs)} />
      <section className="relative overflow-hidden border-b border-line">
        <BrandBackdrop />
        <Container className="relative py-20 text-center sm:py-28">
          <div className="inline-flex flex-col items-center">
            <Eyebrow>Pricing</Eyebrow>
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            A complete website from <span className="text-blue">$999</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-mist">
            Built to rank and convert — then kept that way on a simple monthly care plan.
            No surprises, no separate hosting bill.
          </p>
        </Container>
      </section>

      <Section>
        <Pricing />
      </Section>

      <section className="border-t border-line">
        <Container className="py-20 sm:py-28">
          <div className="mx-auto max-w-3xl">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Pricing questions.
            </h2>
            <dl className="mt-10 divide-y divide-line">
              {faqs.map((f) => (
                <div key={f.q} className="py-6">
                  <dt className="font-display text-lg font-semibold">{f.q}</dt>
                  <dd className="mt-2 leading-relaxed text-mist">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </section>

      <CtaBanner
        title="Not sure which plan fits?"
        body="Tell us about your business and we'll recommend the right build and care plan — no hard sell."
        secondaryHref="/services"
        secondaryLabel="See what's included"
      />
    </>
  );
}
