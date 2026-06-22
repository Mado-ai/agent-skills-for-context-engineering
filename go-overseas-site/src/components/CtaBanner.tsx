import Link from "next/link";
import { Container, Button } from "./ui";
import { Magnetic } from "./Magnetic";
import { Parallax } from "./Parallax";
import { Sparkle, LoopSquiggle } from "./BrandGraphics";

/** Reusable bold gradient CTA block — shared across pages for a consistent close. */
export function CtaBanner({
  title,
  body,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  body: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="border-t border-line">
      <Container className="py-20 sm:py-28">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue via-purple to-pink p-10 sm:p-16">
          <Parallax speed={0.1} className="pointer-events-none absolute -right-12 -top-12 h-60 w-60">
            <Sparkle className="h-full w-full text-white/15 animate-spin-slow" />
          </Parallax>
          <Sparkle className="pointer-events-none absolute right-[26%] bottom-8 h-7 w-7 text-white/80 animate-twinkle" />
          <LoopSquiggle className="pointer-events-none absolute bottom-6 left-6 h-12 w-32 text-white/40" />
          <div className="relative max-w-2xl">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {title}
            </h2>
            <p className="mt-4 text-lg text-white/90">{body}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Magnetic>
                <Button href="/contact">Start a conversation</Button>
              </Magnetic>
              {secondaryHref && (
                <Link
                  href={secondaryHref}
                  className="inline-flex items-center px-2 py-3 text-sm font-semibold text-white/85 hover:text-white"
                >
                  {secondaryLabel} →
                </Link>
              )}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
