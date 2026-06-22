import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";
import { ContactForm } from "@/components/ContactForm";
import { BrandBackdrop, LoopSquiggle, Sparkle } from "@/components/BrandGraphics";

export const metadata: Metadata = {
  title: "Contact — Start a Conversation",
  description:
    "Tell us about your project. Start a conversation with the go overseas team about brand, web, ads, PR, or automation.",
  alternates: { canonical: "/contact" },
};

const details = [
  { label: "Email", value: "hello@gooverseas.com", dot: "bg-blue" },
  { label: "Response time", value: "Within 1 business day", dot: "bg-purple" },
  { label: "Based in", value: "Mississauga · Toronto", dot: "bg-green" },
];

export default function ContactPage() {
  return (
    <section className="relative overflow-hidden">
      <BrandBackdrop />
      <Container className="relative grid gap-14 py-20 sm:py-28 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Eyebrow>Contact</Eyebrow>
          <h1 className="mt-6 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Tell us where you want to grow.
          </h1>
          <LoopSquiggle className="mt-4 h-7 w-28 text-lime" />
          <p className="mt-5 max-w-md text-lg text-mist">
            Whether you have a fully-formed brief or just the seed of an idea,
            we&apos;d like to hear it. No hard sell — just a useful conversation.
          </p>

          <dl className="mt-10 space-y-5">
            {details.map((d) => (
              <div key={d.label}>
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-mist-dim">
                  <span className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
                  {d.label}
                </dt>
                <dd className="mt-1 text-base text-white">{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-7 sm:p-9">
          <Sparkle className="pointer-events-none absolute -right-3 -top-3 h-6 w-6 text-pink animate-twinkle" />
          <ContactForm />
        </div>
      </Container>
    </section>
  );
}
