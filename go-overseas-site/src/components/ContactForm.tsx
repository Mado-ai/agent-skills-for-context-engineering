"use client";

import { useState } from "react";

const field =
  "w-full rounded-xl border border-line bg-ink-900 px-4 py-3 text-sm text-white placeholder:text-mist-dim focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue";

export function ContactForm() {
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "");
    const company = String(data.get("company") || "");
    const market = String(data.get("market") || "");
    const message = String(data.get("message") || "");
    const email = String(data.get("email") || "");

    const body = [
      `Name: ${name}`,
      `Company: ${company}`,
      `Email: ${email}`,
      `Target market(s): ${market}`,
      "",
      message,
    ].join("\n");

    const href = `mailto:hello@gooverseas.example?subject=${encodeURIComponent(
      `New enquiry from ${name || "website"}`
    )}&body=${encodeURIComponent(body)}`;

    window.location.href = href;
    setSent(true);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue to-cyan px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 sm:w-auto"
      >
        {sent ? "Opening your email…" : "Send enquiry"}
      </button>
      {sent && (
        <p className="text-sm text-green">
          Your email client should open. If it doesn&apos;t, write to hello@gooverseas.example.
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
