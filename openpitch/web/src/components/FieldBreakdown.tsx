import type { FieldBreakdown as FB } from "../types";

const LABELS: Record<keyof FB, string> = {
  "5": "5-a-side",
  "7": "7-a-side",
  "11": "11-a-side",
};

export default function FieldBreakdown({ data }: { data: FB }) {
  const total = (data["5"] ?? 0) + (data["7"] ?? 0) + (data["11"] ?? 0);
  return (
    <div className="grid grid-cols-3 gap-3">
      {(Object.keys(LABELS) as (keyof FB)[]).map((k) => (
        <div key={k} className="rounded-lg border border-line bg-ink p-3 text-center">
          <div className="text-2xl font-bold text-pitch">{data[k] ?? 0}</div>
          <div className="text-xs text-slate-400">{LABELS[k]}</div>
        </div>
      ))}
      <div className="col-span-3 text-center text-xs text-slate-500">
        {total} match{total === 1 ? "" : "es"} total
      </div>
    </div>
  );
}
