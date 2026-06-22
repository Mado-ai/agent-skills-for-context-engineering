/**
 * Brand graphic language — the reusable visual motifs from the go overseas
 * identity: flow lines (movement), dynamic circles (connection/focus),
 * growth marks (progress), and the sparkle/star. All are decorative SVGs
 * driven by currentColor so they pick up brand palette utility classes.
 */

export function FlowLines({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 300"
      fill="none"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path d="M0 150C200 60 400 240 600 150S1000 60 1200 150" stroke="currentColor" strokeWidth="2.5" />
      <path d="M0 184C220 96 420 270 640 172S1020 92 1200 178" stroke="currentColor" strokeWidth="1.75" opacity="0.6" />
      <path d="M0 118C180 44 380 210 600 120S980 40 1200 120" stroke="currentColor" strokeWidth="1.25" opacity="0.4" />
    </svg>
  );
}

export function DynamicRings({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" className={className} aria-hidden="true">
      <circle cx="100" cy="100" r="94" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle cx="100" cy="100" r="68" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 11" opacity="0.7" />
      {/* Open arc + green growth dot — the brand "dynamic circle" */}
      <path d="M100 22A78 78 0 0 1 178 100" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="178" cy="100" r="5.5" fill="#32c46a" />
    </svg>
  );
}

export function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" className={className} aria-hidden="true">
      <path d="M50 0C55 35 65 45 100 50 65 55 55 65 50 100 45 65 35 55 0 50 35 45 45 35 50 0Z" />
    </svg>
  );
}

export function GrowthArrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path
        d="M8 46 26 28 38 40 58 16"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44 16H58V30"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Composed hero backdrop used across page heroes for a consistent brand feel.
 * Sits behind content; never intercepts pointer events.
 */
export function BrandBackdrop({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div className="absolute inset-0 bg-grid opacity-40" />

      {/* Color blooms */}
      <div className="absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-blue/15 blur-[120px]" />
      <div className="absolute -bottom-52 -left-40 h-[30rem] w-[30rem] rounded-full bg-green/10 blur-[120px]" />
      <div className="absolute right-1/3 top-1/2 h-72 w-72 rounded-full bg-purple/10 blur-[120px]" />

      {/* Flow lines */}
      <FlowLines className="absolute -left-10 top-1/3 h-64 w-[120%] text-blue/30 animate-drift" />

      {/* Dynamic circles */}
      <DynamicRings className="absolute -right-20 -top-16 h-80 w-80 text-blue/30 animate-spin-slow" />

      {/* Sparkles */}
      <Sparkle className="absolute right-[14%] top-[20%] h-6 w-6 text-blue animate-twinkle" />
      <Sparkle className="absolute left-[7%] bottom-[18%] h-4 w-4 text-green animate-twinkle [animation-delay:1.5s]" />
      <Sparkle className="absolute right-[30%] bottom-[24%] h-5 w-5 text-purple animate-twinkle [animation-delay:3s]" />
    </div>
  );
}
