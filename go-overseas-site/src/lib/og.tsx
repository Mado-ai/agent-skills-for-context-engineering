import { ImageResponse } from "next/og";
import { siteConfig } from "./seo";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/**
 * Shared Open Graph / Twitter card renderer.
 * Brand gradient, logo mark, eyebrow, headline.
 */
export function renderOgImage(opts: { title: string; eyebrow?: string }) {
  const { title, eyebrow = siteConfig.tagline } = opts;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "radial-gradient(1100px 500px at 85% -10%, rgba(0,174,239,0.45), transparent), radial-gradient(900px 500px at 0% 120%, rgba(50,196,106,0.28), transparent), #08090c",
          fontFamily: "sans-serif",
          color: "#ffffff",
        }}
      >
        {/* Top row: logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 48 48" fill="none">
            <path d="M24 6.5A17.5 17.5 0 1 0 41.5 24" stroke="#ffffff" strokeWidth="6.5" strokeLinecap="round" />
            <path d="M18.5 30 29 19.5" stroke="#32c46a" strokeWidth="4.6" strokeLinecap="round" />
            <path d="M22.7 19.5H29V25.8" stroke="#32c46a" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>
            <span>go&nbsp;over</span>
            <span style={{ color: "#00aeef" }}>seas</span>
          </div>
        </div>

        {/* Bottom: eyebrow + headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#00aeef",
              marginBottom: 24,
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 60 ? 60 : 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );
}
