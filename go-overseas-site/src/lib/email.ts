/**
 * Minimal Resend client over the REST API (no SDK dependency).
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */
import { env, isEmailConfigured } from "./env";

export { isEmailConfigured };

type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email service is not configured (missing RESEND_API_KEY).");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail({ to, subject, html, text, replyTo }: SendEmailArgs): Promise<{ id: string }> {
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend request failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as { id: string };
}

/** Escape user-supplied strings before interpolating into HTML email bodies. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
