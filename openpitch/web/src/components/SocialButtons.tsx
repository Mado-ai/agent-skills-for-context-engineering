import { useEffect, useState } from "react";
import { api } from "../api/client";

/* Social-login buttons (adapted from the shadcn social-button examples to our
 * token system). Renders only providers the backend reports as configured, so
 * we never show a button that wouldn't work. Each links to the server-side
 * OAuth start endpoint (full-page navigation, not fetch). */

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
      <path fill="#4285F4" d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.38Z" />
      <path fill="#34A853" d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.74H1.7v2.98A11.5 11.5 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.55 14.68a6.9 6.9 0 0 1 0-4.36V7.34H1.7a11.5 11.5 0 0 0 0 10.32l3.85-2.98Z" />
      <path fill="#EA4335" d="M12 4.77c1.69 0 3.21.58 4.4 1.72l3.3-3.3A11.5 11.5 0 0 0 12 0 11.5 11.5 0 0 0 1.7 6.34l3.85 2.98C6.46 6.79 9 4.77 12 4.77Z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden>
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.94c.57.1.78-.25.78-.55v-1.93c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.79.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

const MARKS: Record<string, () => React.ReactNode> = {
  google: GoogleMark,
  github: GitHubMark,
};

export default function SocialButtons() {
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    api.authProviders().then(setProviders).catch(() => {});
  }, []);

  if (providers.length === 0) return null;

  return (
    <>
      <div className="my-4 flex items-center gap-3 text-xs text-mute">
        <span className="h-px flex-1 bg-line" /> or continue with <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex flex-col gap-2">
        {providers.map((p) => {
          const Mark = MARKS[p.id];
          return (
            <a
              key={p.id}
              href={`/api/auth/oauth/${p.id}/start`}
              className="flex items-center justify-center gap-2.5 rounded-lg border border-line bg-ink-2 py-2.5 text-sm font-medium transition hover:border-line-2"
            >
              {Mark && <Mark />}
              Continue with {p.label}
            </a>
          );
        })}
      </div>
    </>
  );
}
