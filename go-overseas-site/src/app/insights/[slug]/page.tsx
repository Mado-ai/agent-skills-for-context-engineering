import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, Button } from "@/components/ui";
import { getPost, getPostSlugs, formatDate } from "@/lib/posts";

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Not found" };
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, type: "article" },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <article>
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue/15 blur-[120px]" />
        <Container className="relative max-w-3xl py-16 sm:py-20">
          <Link href="/insights" className="text-sm text-mist-dim hover:text-white">
            ← All insights
          </Link>
          <span className="mt-8 block text-xs font-semibold uppercase tracking-[0.18em] text-green">
            {post.category}
          </span>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            {post.title}
          </h1>
          <p className="mt-5 text-sm text-mist-dim">
            By {post.author} · {formatDate(post.date)} · {post.readingTime}
          </p>
        </Container>
      </section>

      <Container className="max-w-3xl py-14">
        <div
          className="prose-go"
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />

        <div className="mt-16 rounded-[var(--radius-card)] border border-line bg-ink-800/50 p-8 text-center">
          <h2 className="font-display text-2xl font-semibold">Thinking about your next market?</h2>
          <p className="mx-auto mt-3 max-w-md text-mist">
            We help companies turn thinking like this into a plan — and the plan into traction.
          </p>
          <div className="mt-6 flex justify-center">
            <Button href="/contact">Start a conversation</Button>
          </div>
        </div>
      </Container>
    </article>
  );
}
