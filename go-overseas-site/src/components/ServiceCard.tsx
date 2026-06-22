import type { ReactNode, ElementType } from "react";
import { Card } from "./ui";

type Service = {
  id: string;
  title: string;
  summary: string;
  points: readonly string[];
};

type Accent = { text: string; chip: string; hover: string; bullet: string };

/** Each service carries its own brand accent colour. */
const ACCENTS: Record<string, Accent> = {
  "brand-identity": { text: "text-purple", chip: "bg-purple/10", hover: "hover:border-purple/50", bullet: "bg-purple" },
  "web-apps": { text: "text-blue", chip: "bg-blue/10", hover: "hover:border-blue/50", bullet: "bg-blue" },
  "paid-media": { text: "text-pink", chip: "bg-pink/10", hover: "hover:border-pink/50", bullet: "bg-pink" },
  "pr-community": { text: "text-green", chip: "bg-green/10", hover: "hover:border-green/50", bullet: "bg-green" },
  "automation-ops": { text: "text-cyan", chip: "bg-cyan/10", hover: "hover:border-cyan/50", bullet: "bg-cyan" },
  "analytics": { text: "text-lime", chip: "bg-lime/10", hover: "hover:border-lime/50", bullet: "bg-lime" },
};

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICONS: Record<string, ReactNode> = {
  "brand-identity": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...stroke}>
      <path d="M12 19l7-7-4-4-7 7v4h4z" />
      <path d="M14 6l4 4" />
    </svg>
  ),
  "web-apps": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...stroke}>
      <path d="M8 9l-3 3 3 3" />
      <path d="M16 9l3 3-3 3" />
      <path d="M13 7l-2 10" />
    </svg>
  ),
  "paid-media": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...stroke}>
      <path d="M4 10v4h3l5 4V6L7 10H4z" />
      <path d="M16 9a3 3 0 010 6" />
    </svg>
  ),
  "pr-community": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...stroke}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0111 0" />
      <path d="M16 5.5a3 3 0 010 5.8" />
      <path d="M20.5 20a5.5 5.5 0 00-3.5-5.1" />
    </svg>
  ),
  "automation-ops": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...stroke}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  ),
  "analytics": (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...stroke}>
      <path d="M4 20V11" />
      <path d="M10 20V4" />
      <path d="M16 20v-6" />
      <path d="M3 20h18" />
    </svg>
  ),
};

export function ServiceCard({
  service,
  headingAs = "h3",
}: {
  service: Service;
  headingAs?: ElementType;
}) {
  const a = ACCENTS[service.id] ?? ACCENTS["web-apps"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Heading = headingAs as any;
  return (
    <Card className={`h-full ${a.hover}`}>
      <span id={service.id} className="block scroll-mt-24" />
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${a.chip} ${a.text}`}>
        {ICONS[service.id]}
      </div>
      <Heading className="mt-5 font-display text-xl font-semibold">{service.title}</Heading>
      <p className="mt-3 text-sm leading-relaxed text-mist">{service.summary}</p>
      <ul className="mt-5 space-y-2">
        {service.points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-sm text-mist">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.bullet}`} />
            {p}
          </li>
        ))}
      </ul>
    </Card>
  );
}
