import { useState } from "react";
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
    <div className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 font-semibold">Your analyses</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-slate-400">No jobs yet.</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-auto">
          {jobs.map((j) => (
            <li
              key={j.id}
              className={`group rounded-lg border bg-ink px-3 py-2.5 ${
                j.id === activeId ? "border-pitch" : "border-line"
              }`}
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
                  className="w-full rounded border border-line bg-card px-2 py-1 text-sm"
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => onSelect(j.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm">{j.input_name}</span>
                    <span className="text-xs text-slate-500">{j.detector}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[0.65rem] ${badge[j.status]}`}>
                      {j.status}
                    </span>
                    <button
                      title="Rename"
                      onClick={() => startEdit(j)}
                      className="rounded p-1 text-slate-500 opacity-0 hover:bg-line hover:text-white group-hover:opacity-100"
                    >
                      ✎
                    </button>
                    <button
                      title="Delete"
                      onClick={() => {
                        if (confirm(`Delete "${j.input_name}"? This cannot be undone.`)) onDelete(j.id);
                      }}
                      className="rounded p-1 text-slate-500 opacity-0 hover:bg-line hover:text-red-400 group-hover:opacity-100"
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
    </div>
  );
}
