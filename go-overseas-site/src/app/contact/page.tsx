import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact — Start a Conversation",
  description:
    "Tell us where you want to grow. Start a conversation with the go overseas team about your international expansion.",
  alternates: { canonical: "/contact" },
};

const details = [
  { label: "Email", value: "hello@gooverseas.example" },
  { label: "Response time", value: "Within 1 business day" },
  { label: "Hubs", value: "London · Singapore · Toronto" },
];

export default function ContactPage() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-blue/15 blur-[120px]" />
      <Container className="relative grid gap-14 py-20 sm:py-28 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Eyebrow>Contact</Eyebrow>
          <h1 className="mt-6 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Tell us where you want to grow.
          </h1>
          <p className="mt-5 max-w-md text-lg text-mist">
            Whether you have a fully-formed expansion plan or just a hunch about a market,
            we&apos;d like to hear it. No hard sell — just a useful conversation.
          </p>

          <dl className="mt-10 space-y-5">
            {details.map((d) => (
              <div key={d.label}>
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-dim">
                  {d.label}
                </dt>
                <dd className="mt-1 text-base text-white">{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-7 sm:p-9">
          <ContactForm />
        </div>
      </Container>
    </section>
  );
}
