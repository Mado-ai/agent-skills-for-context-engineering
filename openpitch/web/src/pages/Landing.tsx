import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const FEATURES = [
  ["🎥", "Capture & auto-produce", "Upload a panoramic clip. The virtual camera pans and zooms to follow play, with a live scoreboard and possession bar."],
  ["📊", "Analyze", "CV tracking yields possession %, top-down heatmaps and per-player distance & speed, calibrated to a real 105×68 m pitch."],
  ["✂️", "Highlight & review", "Exciting moments are detected and cut into clips automatically. Everything lands in your private dashboard."],
];

const PILLS = ["🎥 Auto-production", "📊 Possession & heatmaps", "🏃 Distance & speed", "✂️ Auto highlights", "📐 Pitch homography", "🧠 Color / YOLO"];

export default function Landing() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) return setError("Email and password required.");
    setPending(true);
    try {
      await (mode === "login" ? login(email, password) : register(email, password));
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <section className="mx-auto grid max-w-5xl items-center gap-10 px-5 py-14 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h1 className="text-4xl font-bold leading-tight md:text-5xl">
            Turn one wide camera into a broadcast — and a data room.
          </h1>
          <p className="mt-4 text-lg text-slate-400">
            Play Metrics auto-produces your match, then tracks every player and the ball to deliver possession,
            heatmaps, physical metrics and automatic highlights — no operator required.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {PILLS.map((p) => (
              <span key={p} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm">
                {p}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-card p-6">
          <div className="mb-4 flex gap-1.5">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                  mode === m ? "bg-pitch text-emerald-950" : "bg-ink text-slate-400"
                }`}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="you@club.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-line bg-ink p-2.5 text-sm"
            />
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-line bg-ink p-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-pitch py-2.5 font-semibold text-emerald-950 hover:bg-pitch-dark disabled:opacity-50"
            >
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </form>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-5 pb-16 md:grid-cols-3">
        {FEATURES.map(([icon, title, body]) => (
          <div key={title} className="rounded-xl border border-line bg-card p-5">
            <div className="text-2xl">{icon}</div>
            <h3 className="mt-2 font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-slate-400">{body}</p>
          </div>
        ))}
      </section>
    </>
  );
}
