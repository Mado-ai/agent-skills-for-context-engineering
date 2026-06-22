import type { Job } from "../types";

const badge: Record<Job["status"], string> = {
  done: "bg-emerald-900 text-pitch",
  running: "bg-yellow-900/60 text-yellow-300",
  queued: "bg-yellow-900/60 text-yellow-300",
  error: "bg-red-900/60 text-red-300",
};

interface Props {
  jobs: Job[];
  activeId?: string;
  onSelect: (id: string) => void;
}

export default function JobList({ jobs, activeId, onSelect }: Props) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 font-semibold">Your analyses</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-slate-400">No jobs yet.</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-auto">
          {jobs.map((j) => (
            <li key={j.id}>
              <button
                onClick={() => onSelect(j.id)}
                className={`flex w-full items-center justify-between rounded-lg border bg-ink px-3 py-2.5 text-left hover:border-pitch ${
                  j.id === activeId ? "border-pitch" : "border-line"
                }`}
              >
                <span className="truncate text-sm">
                  {j.input_name} · {j.detector}
                </span>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] ${badge[j.status]}`}>
                  {j.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
