import { useState } from "react";
import { api } from "../api/client";
import { Card, Icon } from "./ui";

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
    <Card title="New analysis" subtitle="Upload a match or run the demo" icon="upload">
      <label className="mb-1.5 block text-xs font-medium text-mute">Match video (panoramic / wide)</label>
      <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-2 bg-ink-2 px-3 py-3 text-sm transition hover:border-pitch/50">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-pitch/10 text-pitch">
          <Icon name="film" width={17} height={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{file ? file.name : "Choose a video file"}</span>
          <span className="text-xs text-mute">{file ? `${(file.size / 1e6).toFixed(1)} MB` : "MP4 / MOV / panoramic feed"}</span>
        </span>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </label>

      <label className="mb-1.5 block text-xs font-medium text-mute">Detector</label>
      <select
        value={detector}
        onChange={(e) => setDetector(e.target.value)}
        className="mb-4 w-full rounded-xl border border-line bg-ink-2 p-2.5 text-sm outline-none focus:border-pitch/60"
      >
        <option value="color">Color segmentation (no download)</option>
        <option value="yolo">YOLO (real footage · needs weights)</option>
      </select>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !file}
          onClick={wrap(() => api.createJob(file!, detector))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-pitch px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-pitch-dark disabled:opacity-50"
        >
          <Icon name="play" width={16} height={16} /> Process upload
        </button>
        <button
          disabled={busy}
          onClick={wrap(() => api.createDemo(10, detector))}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-ink-2 px-4 py-2.5 text-sm font-semibold transition hover:border-line-2 disabled:opacity-50"
        >
          <Icon name="zap" width={16} height={16} /> Demo
        </button>
      </div>

      {busy && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-ink">
            <div className="h-full rounded-full bg-gradient-to-r from-pitch-dark to-pitch transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-mute">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pitch" />
            {progress.message}
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-home">{error}</p>}
    </Card>
  );
}
