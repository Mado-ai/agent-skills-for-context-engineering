import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";
import { BrandBackdrop } from "@/components/BrandGraphics";
import { PortalDemo } from "@/components/PortalDemo";
import { CtaBanner } from "@/components/CtaBanner";

export const metadata: Metadata = {
  title: "Client Portal — Your Whole Growth Picture",
  description:
    "Every care-plan client gets a portal: website traffic, leads, SEO rankings, and CorePay revenue in one place. Explore the live demo.",
  alternates: { canonical: "/portal" },
  robots: { index: false, follow: true },
};

const features = [
  { t: "One login", b: "Traffic, leads, SEO, and revenue — no more juggling dashboards." },
  { t: "Real reporting", b: "Monthly performance you can actually read, not a wall of charts." },
  { t: "Revenue + website together", b: "CorePay revenue beside your site data — a view Wix can't show." },
];

export default function PortalPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <BrandBackdrop />
        <Container className="relative py-20 text-center sm:py-28">
          <div className="inline-flex flex-col items-center">
            <Eyebrow>Client portal</Eyebrow>
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            One login. Your whole <span className="text-blue">growth</span> picture.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-mist">
            Growth and Performance care plans include a private portal — your website traffic,
            leads, SEO rankings, and CorePay revenue, all in one place.
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <PortalDemo />
          <p className="mt-4 text-center text-xs text-mist-dim">
            Live demo with sample data. Switch clients and tabs to explore.
          </p>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.t} className="rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-7">
                <h3 className="font-display text-lg font-semibold">{f.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">{f.b}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <CtaBanner
        title="Want this for your business?"
        body="Every Growth and Performance care plan includes the portal. Let's get your site built and connected."
        secondaryHref="/pricing"
        secondaryLabel="See plans & pricing"
      />
    </>
  );
}
