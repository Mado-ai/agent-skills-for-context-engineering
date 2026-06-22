import { useAuth } from "../auth/AuthContext";
import JobList from "../components/JobList";
import NewAnalysis from "../components/NewAnalysis";
import Results from "../components/Results";
import { Card, Icon } from "../components/ui";
import { useJobs } from "../hooks/useJobs";

const TOOLS: [Parameters<typeof Icon>[0]["name"], string, string][] = [
  ["film", "Virtual camera", "Auto pan/zoom follow"],
  ["shield", "Overlay", "Scoreboard + possession"],
  ["target", "Homography", "Pixels → metres"],
  ["crosshair", "Detection", "Color / YOLO"],
  ["chart", "Analytics", "Heatmaps + xT / xG"],
  ["zap", "Highlights", "Auto clip export"],
];

export default function Dashboard() {
  const { jobs, active, busy, progress, track, open, rename, remove } = useJobs();
  const { user } = useAuth();
  const name = user?.email?.split("@")[0] ?? "coach";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <p className="text-sm text-mute">Welcome back, <span className="capitalize text-slate-300">{name}</span></p>
        <h1 className="text-2xl font-bold tracking-tight">Match analytics</h1>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-5 lg:sticky lg:top-20">
          <NewAnalysis busy={busy} progress={progress} onStarted={track} />
          <JobList
            jobs={jobs}
            activeId={active?.id}
            onSelect={open}
            onRename={rename}
            onDelete={remove}
          />
          <Card title="Pipeline tools" icon="activity">
            <div className="grid grid-cols-2 gap-2.5">
              {TOOLS.map(([icon, name, desc]) => (
                <div key={name} className="rounded-xl border border-line bg-ink-2 p-2.5">
                  <div className="flex items-center gap-1.5 text-pitch">
                    <Icon name={icon} width={14} height={14} />
                    <b className="text-xs text-slate-200">{name}</b>
                  </div>
                  <p className="mt-0.5 text-[0.7rem] text-mute">{desc}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Results job={active} />
      </div>
    </div>
  );
}
