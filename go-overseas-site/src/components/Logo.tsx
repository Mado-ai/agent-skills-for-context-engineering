import Link from "next/link";

/**
 * go overseas brand mark — an open ring ("G" / dynamic circle) with a green
 * growth arrow inside. The ring is monochrome (currentColor) so it sits on
 * dark or light; the growth mark is brand Emerald Green.
 */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Open ring — the "G" / dynamic circle */}
      <path
        d="M24 6.5A17.5 17.5 0 1 0 41.5 24"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      {/* Green growth mark — upward arrow (progress / positive change) */}
      <path d="M18.5 30 29 19.5" stroke="#32c46a" strokeWidth="4.6" strokeLinecap="round" />
      <path
        d="M22.7 19.5H29V25.8"
        stroke="#32c46a"
        strokeWidth="4.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="go overseas — home">
      <LogoMark size={size} />
      <span className="font-display text-[1.1rem] font-semibold lowercase leading-none tracking-tight">
        go over<span className="text-blue">seas</span>
      </span>
    </Link>
  );
}
