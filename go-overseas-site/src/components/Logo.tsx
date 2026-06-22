import Link from "next/link";

/**
 * Brand logo, using the official artwork.
 * - mark-dark.png: the "G" mark (white ring + green bracket) — 164 x 136
 * - logo-dark.png: full "go overseas" wordmark with mark — 924 x 146
 * Both are transparent PNGs tuned for dark backgrounds.
 */
const MARK = { src: "/mark-dark.png", w: 164, h: 136 };
const LOGO = { src: "/logo-dark.png", w: 924, h: 146 };

export function LogoMark({ size = 36 }: { size?: number }) {
  const width = Math.round((size * MARK.w) / MARK.h);
  return (
    <img
      src={MARK.src}
      alt=""
      width={width}
      height={size}
      style={{ height: size, width }}
      aria-hidden="true"
    />
  );
}

export function Logo({ height = 26 }: { height?: number }) {
  const width = Math.round((height * LOGO.w) / LOGO.h);
  return (
    <Link href="/" aria-label="go overseas — home" className="inline-flex items-center">
      <img
        src={LOGO.src}
        alt="go overseas"
        width={width}
        height={height}
        style={{ height, width }}
      />
    </Link>
  );
}
