import type { ReactNode } from "react";
import { Container, Eyebrow } from "./ui";

/* Shared shell for legal / policy pages. */
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue/15 blur-[120px]" />
        <Container className="relative max-w-3xl py-16 sm:py-20">
          <Eyebrow>Legal</Eyebrow>
          <h1 className="mt-6 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 text-mist">{intro}</p>
          <p className="mt-4 text-sm text-mist-dim">Last updated: {updated}</p>
        </Container>
      </section>

      <Container className="max-w-3xl py-14">
        <div className="prose-go">{children}</div>
      </Container>
    </>
  );
}
