"use client";

import { useState } from "react";

const field =
  "w-full rounded-xl border border-line bg-ink-900 px-4 py-3 text-sm text-white placeholder:text-mist-dim focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue";

type Status = "idle" | "sending" | "sent" | "error";

/** URL-encode a flat object for application/x-www-form-urlencoded. */
function encode(data: Record<string, string>) {
  return Object.keys(data)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(data[k]))
    .join("&");
}

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    // Honeypot: if a bot filled the hidden field, silently "succeed".
    if (String(fd.get("bot-field") || "")) {
      setStatus("sent");
      form.reset();
      return;
    }

    const payload: Record<string, string> = { "form-name": "contact" };
    fd.forEach((value, key) => {
      payload[key] = String(value);
    });

    setStatus("sending");
    try {
      // POST to the Netlify Forms detection stub (public/__forms.html).
      const res = await fetch("/__forms.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encode(payload),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setStatus("sent");
      form.reset();
    } catch {
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
    <form
      name="contact"
      method="POST"
      data-netlify="true"
      netlify-honeypot="bot-field"
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      {/* Netlify Forms plumbing */}
      <input type="hidden" name="form-name" value="contact" />
      <p className="hidden">
        <label>
          Don&apos;t fill this out if you&apos;re human: <input name="bot-field" />
        </label>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Name</label>
          <input name="name" required placeholder="Jane Doe" className={field} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Work email</label>
          <input name="email" type="email" required placeholder="jane@company.com" className={field} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Company</label>
          <input name="company" placeholder="Company Inc." className={field} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-mist-dim">Target market(s)</label>
          <input name="market" placeholder="e.g. Japan, Germany" className={field} />
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
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue to-cyan px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto"
      >
        {status === "sending" ? "Sending…" : "Send enquiry"}
      </button>
      {status === "error" && (
        <p className="text-sm text-red-400">
          Something went wrong. Please email us directly at{" "}
          <a href="mailto:hello@gooverseas.com" className="underline">
            hello@gooverseas.com
          </a>
          .
        </p>
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
