import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import ShuffleHero from "../components/ShuffleHero";
import { Icon } from "../components/ui";

const FEATURES: { icon: Parameters<typeof Icon>[0]["name"]; title: string; body: string }[] = [
  { icon: "film", title: "Capture & auto-produce", body: "Upload a panoramic clip. The virtual camera pans and zooms to follow play, with a live scoreboard and possession bar." },
  { icon: "chart", title: "Analyze", body: "CV tracking yields possession %, top-down heatmaps and per-player distance & speed, calibrated to a real 105×68 m pitch." },
  { icon: "film", title: "Highlight & review", body: "Exciting moments are detected and cut into clips automatically. Everything lands in your private dashboard." },
];

export default function Landing() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(
    params.has("signup") ? "register" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  // Hero "Start free" links to /?signup — open the register tab and jump to it.
  useEffect(() => {
    if (params.has("signup")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode("register");
      document.getElementById("get-started")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [params]);

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
      <ShuffleHero />

      <section id="get-started" className="mx-auto max-w-md px-5 pb-16 scroll-mt-20">
        <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
          <h2 className="text-lg font-semibold tracking-tight">Get started in seconds</h2>
          <p className="mb-4 mt-1 text-sm text-mute">Create a free account or sign in to your club.</p>
          <div className="mb-4 flex gap-1.5">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                  mode === m ? "bg-pitch text-emerald-950" : "bg-ink-2 text-mute hover:text-white"
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
              className="rounded-lg border border-line bg-ink-2 p-2.5 text-sm outline-none focus:border-pitch/60"
            />
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-line bg-ink-2 p-2.5 text-sm outline-none focus:border-pitch/60"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-pitch py-2.5 font-semibold text-emerald-950 transition hover:bg-pitch-dark disabled:opacity-50"
            >
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
            {error && <p className="text-sm text-home">{error}</p>}
          </form>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-5 pb-20 md:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="lift rounded-2xl border border-line bg-card p-5 shadow-card hover:border-line-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-pitch/10 text-pitch">
              <Icon name={f.icon} width={20} height={20} />
            </span>
            <h3 className="mt-3 font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-mute">{f.body}</p>
          </div>
        ))}
      </section>
    </>
  );
}
