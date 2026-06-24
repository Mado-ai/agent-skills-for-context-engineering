import { useState, type FormEvent } from "react";

export default function About() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  // No backend mailer in the prototype — compose a mailto instead.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = encodeURIComponent(`${message}\n\n— ${name} (${email})`);
    const subject = encodeURIComponent("Play Metrics enquiry");
    window.location.href = `mailto:hello@playmetrics.example?subject=${subject}&body=${body}`;
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-3xl font-bold md:text-4xl">About Play Metrics</h1>
      <p className="mt-4 text-slate-400">
        Pro-level match analysis has long required expensive multi-camera rigs and manual tagging.
        Play Metrics turns a single wide-angle camera into both a watchable broadcast and a complete
        data room — automatically. Our goal is to put broadcast production and performance analytics
        within reach of every club, academy and grassroots team.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          ["1 camera", "No operator, no multi-rig setup"],
          ["Full pipeline", "Capture → broadcast → analytics → highlights"],
          ["Your data", "Private analyses, per-account isolation"],
        ].map(([h, b]) => (
          <div key={h} className="rounded-xl border border-line bg-card p-4">
            <div className="font-semibold text-pitch">{h}</div>
            <p className="mt-1 text-sm text-slate-400">{b}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-2xl font-bold">Get in touch</h2>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 rounded-2xl border border-line bg-card p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-line bg-ink p-2.5 text-sm"
          />
          <input
            type="email"
            placeholder="you@club.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-line bg-ink p-2.5 text-sm"
          />
        </div>
        <textarea
          placeholder="How can we help?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="rounded-lg border border-line bg-ink p-2.5 text-sm"
        />
        <button
          type="submit"
          disabled={!name || !email || !message}
          className="w-fit rounded-lg bg-pitch px-5 py-2.5 font-semibold text-emerald-950 disabled:opacity-50"
        >
          Send message
        </button>
      </form>
      <p className="mt-3 text-xs text-slate-500">
        Prototype — the form opens your email client; no data is sent to a server.
      </p>
    </div>
  );
}
