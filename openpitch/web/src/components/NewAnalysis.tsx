import { useState } from "react";
import { api } from "../api/client";

interface Props {
  busy: boolean;
  progress: { pct: number; message: string };
  onStarted: (jobId: string) => void;
}

export default function NewAnalysis({ busy, progress, onStarted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [detector, setDetector] = useState("color");
  const [error, setError] = useState("");

  const wrap = (fn: () => Promise<{ job_id: string }>) => async () => {
    setError("");
    try {
      onStarted((await fn()).job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start job");
    }
  };

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 font-semibold">New analysis</h2>

      <label className="mb-1 block text-xs text-slate-400">Match video (panoramic / wide)</label>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mb-3 w-full rounded-lg border border-line bg-ink p-2 text-sm"
      />

      <label className="mb-1 block text-xs text-slate-400">Detector</label>
      <select
        value={detector}
        onChange={(e) => setDetector(e.target.value)}
        className="mb-4 w-full rounded-lg border border-line bg-ink p-2 text-sm"
      >
        <option value="color">Color segmentation (no download)</option>
        <option value="yolo">YOLO (real footage · needs weights)</option>
      </select>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !file}
          onClick={wrap(() => api.createJob(file!, detector))}
          className="rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-pitch-dark disabled:opacity-50"
        >
          Process upload
        </button>
        <button
          disabled={busy}
          onClick={wrap(() => api.createDemo(10, detector))}
          className="rounded-lg bg-line px-4 py-2 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
        >
          Run demo clip
        </button>
      </div>

      {busy && (
        <div className="mt-4">
          <div className="h-2.5 overflow-hidden rounded bg-ink">
            <div className="h-full bg-pitch transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-400">{progress.message}</p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
