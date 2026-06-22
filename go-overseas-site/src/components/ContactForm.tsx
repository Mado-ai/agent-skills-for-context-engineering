"use client";

import { useState } from "react";

const field =
  "w-full rounded-xl border border-line bg-ink-900 px-4 py-3 text-sm text-white placeholder:text-mist-dim focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue";

type Status = "idle" | "sending" | "sent" | "error";
type FieldErrors = Record<string, string>;

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get("name") || ""),
      email: String(fd.get("email") || ""),
      company: String(fd.get("company") || ""),
      market: String(fd.get("market") || ""),
      message: String(fd.get("message") || ""),
      "bot-field": String(fd.get("bot-field") || ""),
    };

    setStatus("sending");
    setErrors({});
    setErrorMsg("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        errors?: FieldErrors;
      };

      if (res.ok && json.ok) {
        setStatus("sent");
        form.reset();
        return;
      }

      if (json.errors) setErrors(json.errors);
      setErrorMsg(json.error || "Please check the highlighted fields and try again.");
      setStatus("error");
    } catch {
      setErrorMsg("Network error. Please try again or email hello@gooverseas.com.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-xl border border-green/40 bg-green/10 p-6">
        <p className="font-display text-lg font-semibold text-white">Thank you — message received.</p>
        <p className="mt-2 text-sm text-mist">
          We&apos;ll be in touch within one business day. Prefer email? Write to{" "}
          <a href="mailto:hello@gooverseas.com" className="text-cyan underline">
            hello@gooverseas.com
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Honeypot: hidden from humans, attractive to bots. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Leave this field empty
          <input name="bot-field" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Name</label>
          <input name="name" required placeholder="Jane Doe" className={field} />
          {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Work email</label>
          <input name="email" type="email" required placeholder="jane@company.com" className={field} />
          {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Company</label>
          <input name="company" placeholder="Company Inc." className={field} />
          {errors.company && <p className="mt-1 text-xs text-red-400">{errors.company}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Target market(s)</label>
          <input name="market" placeholder="e.g. Japan, Germany" className={field} />
          {errors.market && <p className="mt-1 text-xs text-red-400">{errors.market}</p>}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-mist-dim">
          What are you trying to do?
        </label>
        <textarea
          name="message"
          required
          rows={5}
          placeholder="Tell us about your expansion goals…"
          className={field}
        />
        {errors.message && <p className="mt-1 text-xs text-red-400">{errors.message}</p>}
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue to-cyan px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto"
      >
        {status === "sending" ? "Sending…" : "Send enquiry"}
      </button>
      {status === "error" && errorMsg && (
        <p className="text-sm text-red-400">{errorMsg}</p>
      )}
      <p className="text-xs text-mist-dim">
        By submitting, you agree to our{" "}
        <a href="/terms" className="underline hover:text-mist">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline hover:text-mist">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}
