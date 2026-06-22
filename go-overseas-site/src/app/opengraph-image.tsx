import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { siteConfig } from "@/lib/seo";

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "International Growth for Canadian Business",
    title: "Take your Canadian business overseas.",
  });
}
