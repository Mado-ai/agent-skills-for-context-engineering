import { Avatar } from "./ui";

/* Generic broadcast-style head-to-head (mirrors the bein-sports comparison
 * graphic): two competitors, a metric per row, the leader's value highlighted.
 * Callers supply the rows so the same component serves the dashboard's tracking
 * metrics and the profile's full match-stat set. */

export type H2HHeader = {
  name: string;
  sub?: string;
  jersey?: string | number | null;
  color: string;
};

export type H2HRow = {
  label: string;
  a: number;
  b: number;
  fmt?: (n: number) => string;
  better?: "high" | "low";
};

export default function HeadToHead({ a, b, rows }: { a: H2HHeader; b: H2HHeader; rows: H2HRow[] }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar label={String(a.jersey ?? "?")} color={a.color} size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{a.name}</div>
            {a.sub && <div className="truncate text-xs text-mute">{a.sub}</div>}
          </div>
        </div>
        <span className="rounded-full bg-line px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-mute">vs</span>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0 text-right">
            <div className="truncate text-sm font-semibold">{b.name}</div>
            {b.sub && <div className="truncate text-xs text-mute">{b.sub}</div>}
          </div>
          <Avatar label={String(b.jersey ?? "?")} color={b.color} size={40} />
        </div>
      </div>

      <div className="divide-y divide-line/60">
        {rows.map((r) => {
          const fmt = r.fmt ?? ((n: number) => String(n));
          const max = Math.max(r.a, r.b, 0.0001);
          const aWins = r.better === "low" ? r.a < r.b : r.a > r.b;
          const bWins = r.better === "low" ? r.b < r.a : r.b > r.a;
          return (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2">
              <div className="flex items-center justify-end gap-2">
                <span className={`tnum text-sm font-semibold ${aWins ? "" : "text-mute"}`} style={aWins ? { color: a.color } : undefined}>
                  {fmt(r.a)}
                </span>
                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-line sm:w-20">
                  <div className="h-full rounded-full" style={{ width: `${(r.a / max) * 100}%`, background: a.color, marginLeft: "auto" }} />
                </div>
              </div>
              <span className="whitespace-nowrap text-center text-[0.7rem] uppercase tracking-wide text-mute">{r.label}</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-line sm:w-20">
                  <div className="h-full rounded-full" style={{ width: `${(r.b / max) * 100}%`, background: b.color }} />
                </div>
                <span className={`tnum text-sm font-semibold ${bWins ? "" : "text-mute"}`} style={bWins ? { color: b.color } : undefined}>
                  {fmt(r.b)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
