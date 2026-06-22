import Link from "next/link";

/**
 * go overseas mark — a segmented globe/"G" ring in the brand gradient.
 * The open ring evokes both a globe (overseas) and the letter G (go / growth).
 */
export function LogoMark({ size = 36 }: { size?: number }) {
  const id = "go-grad";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2f5bff" />
          <stop offset="0.55" stopColor="#16c8ff" />
          <stop offset="1" stopColor="#1fd17a" />
        </linearGradient>
      </defs>
      {/* Outer open ring (the "G" gap on the right) */}
      <path
        d="M24 6.5A17.5 17.5 0 1 0 41.5 24"
        stroke={`url(#${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      {/* Inner bar of the G */}
      <path
        d="M41.5 24H30"
        stroke={`url(#${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      {/* Growth dot */}
      <circle cx="30" cy="24" r="3.4" fill="#1fd17a" />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="go overseas — home">
      <LogoMark size={size} />
      <span className="font-display text-[1.05rem] font-semibold leading-none tracking-tight">
        go <span className="text-mist">overseas</span>
      </span>
    </Link>
  );
}
