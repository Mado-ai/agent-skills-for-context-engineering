import { useState } from "react";
import type { Job } from "../types";
import { cx } from "../lib/cx";
import { Card } from "./ui";

const badge: Record<Job["status"], string> = {
  done: "bg-pitch/15 text-pitch",
  running: "bg-amber/15 text-amber",
  queued: "bg-amber/15 text-amber",
  error: "bg-home/15 text-home",
};

interface Props {
  jobs: Job[];
  activeId?: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function JobList({ jobs, activeId, onSelect, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (j: Job) => {
    setEditing(j.id);
    setDraft(j.input_name);
  };

  const commit = async (id: string) => {
    const name = draft.trim();
    setEditing(null);
    if (name) await onRename(id, name);
  };

  return (
    <Card title="Your analyses" subtitle={jobs.length ? `${jobs.length} report${jobs.length === 1 ? "" : "s"}` : undefined} icon="chart">
      {jobs.length === 0 ? (
        <p className="text-sm text-mute">No matches analysed yet — run the demo to see a full report.</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-auto">
          {jobs.map((j) => (
            <li
              key={j.id}
              className={cx(
                "lift group rounded-xl border bg-ink-2 px-3 py-2.5",
                j.id === activeId ? "border-pitch/70 ring-1 ring-pitch/20" : "border-line hover:border-line-2",
              )}
            >
              {editing === j.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(j.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(j.id);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="w-full rounded-lg border border-line bg-card px-2 py-1 text-sm outline-none focus:border-pitch/60"
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => onSelect(j.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{j.input_name}</span>
                    <span className="text-xs text-mute">{j.detector}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className={cx("rounded-full px-2 py-0.5 text-[0.65rem] font-medium", badge[j.status])}>
                      {j.status}
                    </span>
                    <button
                      title="Rename"
                      onClick={() => startEdit(j)}
                      className="rounded-md p-1 text-mute opacity-0 transition hover:bg-line hover:text-white group-hover:opacity-100"
                    >
                      ✎
                    </button>
                    <button
                      title="Delete"
                      onClick={() => {
                        if (confirm(`Delete "${j.input_name}"? This cannot be undone.`)) onDelete(j.id);
                      }}
                      className="rounded-md p-1 text-mute opacity-0 transition hover:bg-line hover:text-home group-hover:opacity-100"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
