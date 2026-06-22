import { NextResponse } from "next/server";
import { validateSubscribe } from "@/lib/validation";
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

  const { data, errors } = validateSubscribe(body);
  if (errors) {
    return NextResponse.json({ ok: false, errors }, { status: 422 });
  }

  // Honeypot: silently accept bot submissions.
  if (data.botField) {
    return NextResponse.json({ ok: true });
  }

  const limit = rateLimit(`subscribe:${clientIp(req)}`);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!isEmailConfigured()) {
    console.error("[subscribe] received but email is not configured", { email: data.email });
    return NextResponse.json(
      { ok: false, error: "Subscriptions are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  try {
    // Notify the team of the new subscriber.
    await sendEmail({
      to: env.newsletterToEmail,
      subject: `New newsletter subscriber: ${data.email}`,
      html: `<p style="font-family:Inter,Arial,sans-serif">New Insights subscriber: <strong>${escapeHtml(data.email)}</strong></p>`,
      text: `New Insights subscriber: ${data.email}`,
      replyTo: data.email,
    });

    // Confirmation to the subscriber.
    await sendEmail({
      to: data.email,
      subject: "You're subscribed to go overseas Insights",
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#0f1218;line-height:1.6">
          <p>Thanks for subscribing to <strong>go overseas Insights</strong>.</p>
          <p>You'll get our perspective on brand, marketing, automation, and growth — no spam, unsubscribe anytime.</p>
          <p style="color:#7c869a;font-size:13px">Strategy · Creativity · Growth</p>
        </div>`,
      text: "Thanks for subscribing to go overseas Insights. Strategy · Creativity · Growth",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: "Subscriptions are temporarily unavailable. Please try again later." },
        { status: 503 },
      );
    }
    console.error("[subscribe] failed", err);
    return NextResponse.json(
      { ok: false, error: "We couldn't complete your subscription. Please try again." },
      { status: 502 },
    );
  }
}
