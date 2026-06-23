import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";
import { BrandBackdrop } from "@/components/BrandGraphics";
import { LoginForm } from "@/components/auth/LoginForm";
import { isAuthConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Sign in to your portal",
  description:
    "Sign in to your go overseas client portal to view your website traffic, leads, SEO rankings, and revenue.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/portal";

  return (
    <section className="relative overflow-hidden">
      <BrandBackdrop />
      <Container className="relative flex min-h-[calc(100vh-200px)] flex-col items-center justify-center py-20">
        <div className="w-full max-w-md">
          <div className="text-center">
            <div className="inline-flex flex-col items-center">
              <Eyebrow>Client portal</Eyebrow>
            </div>
            <h1 className="mt-6 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Sign in to your <span className="text-blue">portal</span>
            </h1>
            <p className="mt-3 text-sm text-mist">
              Access your traffic, leads, SEO rankings, and revenue in one place.
            </p>
          </div>

          {error && (
            <p className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {decodeURIComponent(error)}
            </p>
          )}

          <div className="mt-8 rounded-[var(--radius-card)] border border-line bg-ink-800/60 p-6 sm:p-8">
            <LoginForm configured={isAuthConfigured()} next={safeNext} />
          </div>

          <p className="mt-6 text-center text-xs text-mist-dim">
            Don&apos;t have a portal yet?{" "}
            <a href="/pricing" className="text-cyan underline hover:text-white">
              See plans &amp; pricing
            </a>
          </p>
        </div>
      </Container>
    </section>
  );
}
