import type { ReactNode, SVGProps } from "react";
import { cx } from "../lib/cx";

/* ----------------------------------------------------------------- icons --
 * A tiny inline stroke-icon set so the dashboard stays dependency-free.   */

type IconName =
  | "activity"
  | "gauge"
  | "zap"
  | "target"
  | "crosshair"
  | "route"
  | "trophy"
  | "film"
  | "upload"
  | "play"
  | "flame"
  | "users"
  | "chart"
  | "share"
  | "shield";

const PATHS: Record<IconName, ReactNode> = {
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  gauge: <><path d="M12 14 18 8" /><path d="M3.05 11a9 9 0 1 1 17.9 0" /></>,
  zap: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  crosshair: <><circle cx="12" cy="12" r="9" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  route: <><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H14a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5.5" /></>,
  trophy: <><path d="M6 4h12v4a6 6 0 0 1-12 0Z" /><path d="M6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3" /><path d="M9 20h6M12 14v6" /></>,
  film: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  play: <path d="m7 4 12 8-12 8V4Z" />,
  flame: <path d="M12 2c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3 1 2 2 2 2 2 0-3-1-5 2-8Z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5a3.5 3.5 0 0 1 0 6M22 20a6.5 6.5 0 0 0-5-6.3" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-6" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8 15.8 7.2M8.2 13.2l7.6 3.6" /></>,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />,
};

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------ card -- */

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={cx(
        "rounded-2xl border border-line bg-card shadow-card",
        "bg-gradient-to-b from-white/[0.02] to-transparent",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-pitch/10 text-pitch">
                <Icon name={icon} width={15} height={15} />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>}
              {subtitle && <p className="truncate text-xs text-mute">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------- stat card -- */

const ACCENTS = {
  pitch: "text-pitch bg-pitch/10",
  home: "text-home bg-home/10",
  away: "text-away bg-away/10",
  amber: "text-amber bg-amber/10",
  violet: "text-violet bg-violet/10",
} as const;

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  accent = "pitch",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  icon: Parameters<typeof Icon>[0]["name"];
  accent?: keyof typeof ACCENTS;
}) {
  return (
    <div className="lift rounded-2xl border border-line bg-card p-4 shadow-card hover:border-line-2">
      <div className="flex items-center justify-between">
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-mute">{label}</span>
        <span className={cx("grid h-7 w-7 place-items-center rounded-lg", ACCENTS[accent])}>
          <Icon name={icon} width={15} height={15} />
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tnum text-2xl font-bold tracking-tight">{value}</span>
        {unit && <span className="text-xs text-mute">{unit}</span>}
      </div>
      {hint && <p className="mt-0.5 text-xs text-mute">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- badges -- */

export function Badge({ children, color = "slate" }: { children: ReactNode; color?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const map = {
    slate: "bg-line text-slate-300",
    green: "bg-pitch/15 text-pitch",
    amber: "bg-amber/15 text-amber",
    red: "bg-home/15 text-home",
    blue: "bg-away/15 text-away",
  } as const;
  return (
    <span className={cx("rounded-full px-2 py-0.5 text-[0.65rem] font-medium", map[color])}>
      {children}
    </span>
  );
}

export function TeamChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

/** Jersey-number / initials avatar, optionally overlaid with a photo. */
export function Avatar({ label, color, size = 34, src }: { label: string; color: string; size?: number; src?: string }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white ring-1 ring-inset ring-white/15"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
      }}
    >
      {label}
      {src && (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      )}
    </span>
  );
}

/* ----------------------------------------------------------------- donut -- */

/** Two-segment donut via conic-gradient (no charting dep). */
export function Donut({
  a,
  b,
  colorA,
  colorB,
  size = 132,
  center,
  caption,
}: {
  a: number;
  b: number;
  colorA: string;
  colorB: string;
  size?: number;
  center?: ReactNode;
  caption?: ReactNode;
}) {
  const total = a + b || 1;
  const pct = (a / total) * 100;
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative grid place-items-center rounded-full"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(${colorA} 0 ${pct}%, ${colorB} ${pct}% 100%)`,
        }}
      >
        <div
          className="grid place-items-center rounded-full bg-card"
          style={{ width: size * 0.66, height: size * 0.66 }}
        >
          {center}
        </div>
      </div>
      {caption}
    </div>
  );
}

/** Horizontal "home vs away" comparison row with dual bars. */
export function VersusRow({
  label,
  a,
  b,
  colorA,
  colorB,
  fmt = (n) => String(n),
}: {
  label: string;
  a: number;
  b: number;
  colorA: string;
  colorB: string;
  fmt?: (n: number) => string;
}) {
  const max = Math.max(a, b, 0.0001);
  return (
    <div className="grid grid-cols-[3.2rem_1fr_5.5rem_1fr_3.2rem] items-center gap-2 py-1.5">
      <span className="tnum text-right text-sm font-semibold">{fmt(a)}</span>
      <div className="flex justify-end">
        <div className="h-2 rounded-full" style={{ width: `${(a / max) * 100}%`, background: colorA, minWidth: 2 }} />
      </div>
      <span className="text-center text-[0.7rem] uppercase tracking-wide text-mute">{label}</span>
      <div>
        <div className="h-2 rounded-full" style={{ width: `${(b / max) * 100}%`, background: colorB, minWidth: 2 }} />
      </div>
      <span className="tnum text-sm font-semibold">{fmt(b)}</span>
    </div>
  );
}

/** Inline value-vs-max bar used inside table cells. */
export function CellBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ------------------------------------------------------------------ tabs -- */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: Parameters<typeof Icon>[0]["name"] }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-ink-2 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
            active === t.id ? "bg-card text-white shadow-card" : "text-mute hover:text-white",
          )}
        >
          {t.icon && <Icon name={t.icon} width={15} height={15} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}
