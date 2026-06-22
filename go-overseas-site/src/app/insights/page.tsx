import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@/components/ui";
import { getAllPosts, formatDate } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Insights",
  description:
    "Field notes on international business development, market entry, and cross-border brand growth from the go overseas team.",
};

export default function InsightsPage() {
  const posts = getAllPosts();
  const [featured, ...rest] = posts;

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <Container className="relative py-20 sm:py-28">
          <Eyebrow>Insights</Eyebrow>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Field notes from the front lines of expansion.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-mist">
            Practical thinking on market entry, partnerships, and building brands that travel.
          </p>
        </Container>
      </section>

      <Container className="py-16 sm:py-20">
        {posts.length === 0 ? (
          <p className="text-mist-dim">No posts yet — check back soon.</p>
        ) : (
          <>
            {featured && (
              <Link
                href={`/insights/${featured.slug}`}
                className="group block overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-br from-blue/10 via-ink-800 to-green/5 p-8 transition-colors hover:border-mist-dim/40 sm:p-12"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-green">
                  {featured.category}
                </span>
                <h2 className="mt-4 max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight group-hover:text-gradient sm:text-4xl">
                  {featured.title}
                </h2>
                <p className="mt-4 max-w-2xl text-mist">{featured.excerpt}</p>
                <p className="mt-6 text-sm text-mist-dim">
                  {formatDate(featured.date)} · {featured.readingTime}
                </p>
              </Link>
            )}

            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {rest.map((post) => (
                <Link
                  key={post.slug}
                  href={`/insights/${post.slug}`}
                  className="group flex flex-col rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-7 transition-colors hover:border-mist-dim/40"
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-green">
                    {post.category}
                  </span>
                  <h3 className="mt-3 font-display text-xl font-semibold leading-snug group-hover:text-gradient">
                    {post.title}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-mist">{post.excerpt}</p>
                  <p className="mt-5 text-xs text-mist-dim">
                    {formatDate(post.date)} · {post.readingTime}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}
      </Container>
    </>
  );
}
