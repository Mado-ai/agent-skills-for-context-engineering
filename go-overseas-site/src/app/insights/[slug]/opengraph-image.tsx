import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { getPost, getPostSlugs } from "@/lib/posts";
import { siteConfig } from "@/lib/seo";

export const alt = `${siteConfig.name} — Insights`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  return renderOgImage({
    eyebrow: post?.category ?? "Insights",
    title: post?.title ?? "Insights",
  });
}
