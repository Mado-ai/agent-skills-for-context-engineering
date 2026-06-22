"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

export function NewsletterForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      email: String(fd.get("email") || ""),
      "bot-field": String(fd.get("bot-field") || ""),
    };

    setStatus("sending");
    setMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        errors?: Record<string, string>;
      };

      if (res.ok && json.ok) {
        setStatus("sent");
        form.reset();
        return;
      }
      setMessage(json.errors?.email || json.error || "Something went wrong. Please try again.");
      setStatus("error");
    } catch {
      setMessage("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <p className="text-sm text-green">
        You&apos;re subscribed — check your inbox for a confirmation.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full" noValidate>
      <div className="hidden" aria-hidden="true">
        <label>
          Leave empty
          <input name="bot-field" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          aria-label="Email address"
          className="w-full rounded-full border border-line bg-ink-900 px-5 py-3 text-sm text-white placeholder:text-mist-dim focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue to-cyan px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {status === "sending" ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      {status === "error" && message && <p className="mt-2 text-sm text-red-400">{message}</p>}
    </form>
  );
}
