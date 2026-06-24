import { Link } from "react-router-dom";

type Col = { title: string; links: { label: string; to: string; badge?: string }[] };

const COLUMNS: Col[] = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "Hardware", to: "/hardware" },
      { label: "Pricing", to: "/pricing" },
      { label: "Dashboard", to: "/dashboard" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Event model (xT · xG)", to: "/features", badge: "New" },
      { label: "Team & player profiles", to: "/features" },
      { label: "Capture sites", to: "/features" },
      { label: "Auto highlights", to: "/features" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/about" },
      { label: "Careers", to: "/about", badge: "Hiring" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", to: "/about" },
      { label: "Terms", to: "/about" },
      { label: "Child safety", to: "/about" },
    ],
  },
];

function Social({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-card text-mute transition hover:border-line-2 hover:text-white"
    >
      {children}
    </a>
  );
}

const ico = "h-[18px] w-[18px]";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-ink-2/60">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          {/* brand + description + social */}
          <div className="md:max-w-xs">
            <Link to="/" className="text-lg font-bold tracking-tight">
              ⚽ Play<span className="text-pitch">Metrics</span>
            </Link>
            <p className="mt-3 text-sm text-mute">
              One wide camera becomes an auto-produced broadcast and a full data room —
              capture, analytics, and player development for every club.
            </p>
            <div className="mt-4 flex gap-2">
              <Social href="https://x.com" label="X / Twitter">
                <svg viewBox="0 0 24 24" fill="currentColor" className={ico}>
                  <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.75l-5.28-6.9L4.92 22H1.66l8.02-9.17L1 2h6.92l4.77 6.31L18.244 2Zm-1.184 18h1.86L7.04 3.9H5.06L17.06 20Z" />
                </svg>
              </Social>
              <Social href="https://linkedin.com" label="LinkedIn">
                <svg viewBox="0 0 24 24" fill="currentColor" className={ico}>
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
                </svg>
              </Social>
              <Social href="https://instagram.com" label="Instagram">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={ico}>
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </Social>
              <Social href="https://youtube.com" label="YouTube">
                <svg viewBox="0 0 24 24" fill="currentColor" className={ico}>
                  <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" />
                </svg>
              </Social>
            </div>
          </div>

          {/* link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title} className="flex flex-col gap-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-mute">{col.title}</h4>
                {col.links.map((l) => (
                  <Link key={l.label} to={l.to} className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white">
                    {l.label}
                    {l.badge && (
                      <span className="rounded bg-pitch/15 px-1 text-[0.6rem] font-medium text-pitch">{l.badge}</span>
                    )}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-line pt-6 text-xs text-mute sm:flex-row">
          <p>© {new Date().getFullYear()} Play Metrics — AI soccer capture &amp; analytics.</p>
          <p className="text-slate-600">Prototype — self-hosted. Not affiliated with any commercial provider.</p>
        </div>
      </div>
    </footer>
  );
}
