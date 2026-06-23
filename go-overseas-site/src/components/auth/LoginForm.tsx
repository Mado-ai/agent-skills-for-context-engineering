"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const field =
  "w-full rounded-xl border border-line bg-ink-900 px-4 py-3 text-sm text-white placeholder:text-mist-dim focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 2.9 14.6 2 12 2 6.9 2 2.8 6.1 2.8 11.2S6.9 20.4 12 20.4c6.1 0 9.4-4.3 9.4-9.3 0-.6-.06-1-.16-1.5H12z" />
    </svg>
  );
}
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#1877F2">
      <path d="M24 12c0-6.6-5.4-12-12-12S0 5.4 0 12c0 6 4.4 11 10.1 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.6.2 2.6.2v2.9h-1.5c-1.5 0-1.9.9-1.9 1.8V12h3.3l-.5 3.5h-2.8v8.4C19.6 23 24 18 24 12z" />
    </svg>
  );
}

type Msg = { type: "error" | "info"; text: string } | null;

export function LoginForm({ configured, next }: { configured: boolean; next: string }) {
  const supabase = configured ? createClient() : null;
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"enter" | "verify">("enter");

  const redirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : undefined;

  if (!configured) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-6 text-sm text-mist">
        <p className="font-semibold text-white">Login isn&apos;t connected yet.</p>
        <p className="mt-2">
          Add your Supabase keys (<code className="text-cyan">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-cyan">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) and enable Google,
          Facebook, phone, and email providers in Supabase to turn this on.
        </p>
      </div>
    );
  }

  async function oauth(provider: "google" | "facebook") {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase!.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      setMsg({ type: "error", text: error.message });
      setBusy(false);
    }
  }

  async function sendEmailLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase!.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    setBusy(false);
    setMsg(
      error
        ? { type: "error", text: error.message }
        : { type: "info", text: "Check your email for a secure sign-in link." },
    );
  }

  async function sendPhoneCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase!.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) setMsg({ type: "error", text: error.message });
    else {
      setPhoneStep("verify");
      setMsg({ type: "info", text: "We texted you a 6-digit code." });
    }
  }

  async function verifyPhoneCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase!.auth.verifyOtp({ phone, token: code, type: "sms" });
    setBusy(false);
    if (error) setMsg({ type: "error", text: error.message });
    else window.location.assign(next);
  }

  return (
    <div className="space-y-5">
      {/* OAuth */}
      <div className="grid gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => oauth("google")}
          className="inline-flex items-center justify-center gap-3 rounded-full border border-line bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-white/90 disabled:opacity-60"
        >
          <GoogleIcon /> Continue with Google
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => oauth("facebook")}
          className="inline-flex items-center justify-center gap-3 rounded-full border border-line bg-ink-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-700 disabled:opacity-60"
        >
          <FacebookIcon /> Continue with Facebook
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs text-mist-dim">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      {/* Email magic link */}
      <form onSubmit={sendEmailLink} className="space-y-2">
        <label className="block text-xs font-medium text-mist-dim">Email magic link</label>
        <div className="flex gap-2">
          <input
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 rounded-xl bg-gradient-to-r from-blue to-cyan px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </form>

      {/* Phone OTP */}
      {phoneStep === "enter" ? (
        <form onSubmit={sendPhoneCode} className="space-y-2">
          <label className="block text-xs font-medium text-mist-dim">Phone (SMS code)</label>
          <div className="flex gap-2">
            <input
              type="tel"
              required
              placeholder="+1 555 000 1234"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={field}
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-white hover:border-mist-dim disabled:opacity-60"
            >
              Text me
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={verifyPhoneCode} className="space-y-2">
          <label className="block text-xs font-medium text-mist-dim">Enter the code sent to {phone}</label>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              required
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={field}
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-xl bg-gradient-to-r from-blue to-cyan px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Verify
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setPhoneStep("enter");
              setCode("");
              setMsg(null);
            }}
            className="text-xs text-mist-dim hover:text-white"
          >
            ← Use a different number
          </button>
        </form>
      )}

      {msg && (
        <p className={`text-sm ${msg.type === "error" ? "text-red-400" : "text-green"}`}>{msg.text}</p>
      )}
      <p className="text-xs text-mist-dim">
        By continuing you agree to our{" "}
        <a href="/terms" className="underline hover:text-mist">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline hover:text-mist">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
