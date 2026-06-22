import { Link } from "react-router-dom";

const SECTIONS = [
  {
    icon: "🎥",
    title: "Automated capture & production",
    body: "Mount one wide-angle camera. A virtual cameraman crops and tracks the action with smoothed pan and zoom, then burns in a live scoreboard and possession bar — broadcast output with no operator.",
  },
  {
    icon: "🧠",
    title: "Computer-vision tracking",
    body: "Players and the ball are detected every frame (colour-segmentation by default, or a YOLO model for real footage) and tracked with persistent IDs and team assignment.",
  },
  {
    icon: "📐",
    title: "Pitch homography",
    body: "Image pixels are mapped to a real 105×68 m pitch model, so distance and speed are reported in true metres and heatmaps are rendered top-down.",
  },
  {
    icon: "📊",
    title: "Performance analytics",
    body: "Possession %, possession-over-time, positional heatmaps, and per-player distance and top speed — the data room a coach actually uses.",
  },
  {
    icon: "✂️",
    title: "Automatic highlights",
    body: "Exciting moments — fast ball into an attacking third — are detected and cut into standalone clips automatically.",
  },
  {
    icon: "🔒",
    title: "Private by account",
    body: "Every analysis is tied to your account. Job history and result media are isolated per user and served only with a valid token.",
  },
];

export default function Features() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-3xl font-bold md:text-4xl">Everything from one camera</h1>
      <p className="mt-3 max-w-2xl text-slate-400">
        Play Metrics covers the full pipeline — capture, broadcast production, tracking, analytics
        and highlights — in a single automated workflow.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <div key={s.title} className="rounded-xl border border-line bg-card p-5">
            <div className="text-2xl">{s.icon}</div>
            <h2 className="mt-2 font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{s.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 text-center">
        <Link to="/?signup" className="rounded-lg bg-pitch px-5 py-2.5 font-semibold text-emerald-950">
          Get started free
        </Link>
      </div>
    </div>
  );
}
