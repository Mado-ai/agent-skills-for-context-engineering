import JobList from "../components/JobList";
import NewAnalysis from "../components/NewAnalysis";
import Results from "../components/Results";
import { useJobs } from "../hooks/useJobs";

const TOOLS = [
  ["🎥 Virtual camera", "Auto pan/zoom follow"],
  ["🏷️ Overlay", "Scoreboard + possession"],
  ["📐 Homography", "Pixels → metres"],
  ["🧠 Detection", "Color / YOLO"],
  ["📊 Analytics", "Heatmaps + physical"],
  ["✂️ Highlights", "Auto clip export"],
];

export default function Dashboard() {
  const { jobs, active, busy, progress, track, open } = useJobs();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-5">
          <NewAnalysis busy={busy} progress={progress} onStarted={track} />
          <JobList jobs={jobs} activeId={active?.id} onSelect={open} />
          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="mb-3 font-semibold">Pipeline tools</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {TOOLS.map(([name, desc]) => (
                <div key={name} className="rounded-lg border border-line bg-ink p-2.5">
                  <b className="text-sm">{name}</b>
                  <p className="mt-0.5 text-xs text-slate-400">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Results job={active} />
      </div>
    </div>
  );
}
