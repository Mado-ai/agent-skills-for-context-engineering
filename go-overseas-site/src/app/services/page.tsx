import type { Metadata } from "next";
import { Container, Section, Button, Eyebrow } from "@/components/ui";
import { BrandBackdrop } from "@/components/BrandGraphics";
import { ServiceCard } from "@/components/ServiceCard";
import { JsonLd } from "@/components/JsonLd";
import { services, process } from "@/lib/site";
import { faqSchema } from "@/lib/seo";

const faqs = [
  {
    q: "What does a creative management agency do?",
    a: "We handle brand, marketing, and the systems behind them — brand identity and design, website and app development, paid advertising on Meta, Facebook and TikTok, PR and community, automation, and analytics — all under one roof.",
  },
  {
    q: "How much does a website or branding project cost?",
    a: "It depends on scope. Marketing websites typically range from a few thousand to mid-five figures, and brand identity projects vary by depth. We give clear, fixed quotes after a short discovery call.",
  },
  {
    q: "Do you manage Meta, Facebook, and TikTok ads?",
    a: "Yes. We plan, create, and manage full-funnel paid campaigns across Meta, Facebook, and TikTok — including audience targeting, creative testing, and ROAS optimization.",
  },
  {
    q: "Where is go overseas based?",
    a: "We're based in the Greater Toronto Area (Mississauga and Toronto) and work with brands, entrepreneurs, and organizations remotely.",
  },
  {
    q: "How do we get started?",
    a: "Start a conversation through our contact page. We'll learn about your goals and recommend the right mix of services — no hard sell.",
  },
];

export const metadata: Metadata = {
  title: "Services — Brand, Web, Ads, PR & Automation",
  description:
    "Brand identity, website & app development, paid advertising on Meta, Facebook & TikTok, PR & community, automation, and analytics — full-service creative management.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <>
      <JsonLd data={faqSchema(faqs)} />
      <section className="relative overflow-hidden border-b border-line">
        <BrandBackdrop />
        <Container className="relative py-20 sm:py-28">
          <Eyebrow>Services</Eyebrow>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            One team for brand, build, and growth.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-mist">
            Most agencies do one thing. We cover the whole journey — brand identity,
            websites and apps, advertising, PR, automation, and the reporting that ties it
            all together.
          </p>
        </Container>
      </section>

      <Section>
        <div className="grid gap-6 lg:grid-cols-2">
          {services.map((service) => (
            <ServiceCard key={service.id} service={service} headingAs="h2" />
          ))}
        </div>
      </Section>

      <section className="border-y border-line bg-ink-900">
        <Container className="py-20 sm:py-28">
          <Eyebrow>Engagement model</Eyebrow>
          <h2 className="mt-5 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Discover, design, deliver, optimize.
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

      <section className="border-t border-line">
        <Container className="py-20 sm:py-28">
          <div className="mx-auto max-w-3xl">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Common questions.
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

      <Section className="text-center">
        <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Not sure where to start?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-mist">
          A 30-minute conversation is usually enough to map out what your brand needs — and how
          we&apos;d help.
        </p>
        <div className="mt-8 flex justify-center">
          <Button href="/contact">Book an intro call</Button>
        </div>
      </Section>
    </>
  );
}
