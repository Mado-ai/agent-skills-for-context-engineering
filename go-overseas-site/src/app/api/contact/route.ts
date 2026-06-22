import { NextResponse } from "next/server";
import { validateContact } from "@/lib/validation";
import { sendEmail, isEmailConfigured, escapeHtml, EmailNotConfiguredError } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { data, errors } = validateContact(body);
  if (errors) {
    return NextResponse.json({ ok: false, errors }, { status: 422 });
  }

  // Honeypot: silently accept bot submissions so they don't retry.
  if (data.botField) {
    return NextResponse.json({ ok: true });
  }

  const limit = rateLimit(`contact:${clientIp(req)}`);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!isEmailConfigured()) {
    console.error("[contact] received but email is not configured", { name: data.name, email: data.email });
    return NextResponse.json(
      { ok: false, error: "Our message service is temporarily unavailable. Please email us directly at hello@gooverseas.com." },
      { status: 503 },
    );
  }

  const rows: Array<[string, string]> = [
    ["Name", data.name],
    ["Email", data.email],
    ["Company", data.company || "—"],
    ["Service of interest", data.service || "—"],
  ];

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f1218;line-height:1.6">
      <h2 style="margin:0 0 16px">New enquiry from the website</h2>
      <table style="border-collapse:collapse;font-size:14px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:4px 16px 4px 0;color:#7c869a">${escapeHtml(k)}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`,
          )
          .join("")}
      </table>
      <p style="margin:20px 0 6px;color:#7c869a;font-size:13px">Message</p>
      <p style="white-space:pre-wrap;margin:0;font-size:14px">${escapeHtml(data.message)}</p>
    </div>`;

  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nMessage:\n${data.message}`;

  try {
    await sendEmail({
      to: env.contactToEmail,
      subject: `New enquiry from ${data.name}`,
      html,
      text,
      replyTo: data.email,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: "Our message service is temporarily unavailable. Please email us directly at hello@gooverseas.com." },
        { status: 503 },
      );
    }
    console.error("[contact] failed to send", err);
    return NextResponse.json(
      { ok: false, error: "We couldn't send your message. Please try again or email hello@gooverseas.com." },
      { status: 502 },
    );
  }
}
