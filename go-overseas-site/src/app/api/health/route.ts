import { NextResponse } from "next/server";
import { isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness/health probe for uptime monitoring. */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        email: isEmailConfigured() ? "configured" : "not_configured",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
