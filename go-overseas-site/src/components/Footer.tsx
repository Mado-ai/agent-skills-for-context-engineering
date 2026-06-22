import Link from "next/link";
import { LogoMark } from "./Logo";
import { Container } from "./ui";

const cols = [
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/work", label: "Work" },
      { href: "/insights", label: "Insights" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Services",
    links: [
      { href: "/services#market-entry", label: "Market Entry" },
      { href: "/services#partnerships", label: "Partnerships" },
      { href: "/services#brand-growth", label: "Brand & Growth" },
      { href: "/services#go-to-market", label: "Go-to-Market" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms & Conditions" },
      { href: "/refund", label: "Money-Back Policy" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink-900">
      <Container className="grid gap-12 py-16 sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="font-display text-base font-semibold tracking-tight">
              go <span className="text-mist">overseas</span>
            </span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-mist-dim">
            Strategy. Creativity. Growth. We help ambitious companies cross borders —
            turning international ambition into market presence.
          </p>
        </div>

        {cols.map((col) => (
          <div key={col.title}>
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-dim">
              {col.title}
            </h4>
            <ul className="mt-4 space-y-3">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-mist transition-colors hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>

      <div className="border-t border-line">
        <Container className="flex flex-col items-center justify-between gap-3 py-6 text-xs text-mist-dim sm:flex-row">
          <p>© {new Date().getFullYear()} go overseas. All rights reserved.</p>
          <p>Strategy · Creativity · Growth</p>
        </Container>
      </div>
    </footer>
  );
}
