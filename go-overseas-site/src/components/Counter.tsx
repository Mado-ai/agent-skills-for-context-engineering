"use client";

import { useEffect, useRef, useState } from "react";

/** Splits "CA$4.2M+" into prefix / number / suffix so we can animate the number. */
function parse(value: string) {
  const m = String(value).match(/^([^\d-]*)(-?\d+(?:\.\d+)?)(.*)$/s);
  if (!m) return null;
  const numStr = m[2] ?? "0";
  return {
    prefix: m[1] ?? "",
    suffix: m[3] ?? "",
    target: parseFloat(numStr),
    decimals: numStr.includes(".") ? numStr.split(".")[1].length : 0,
  };
}

/** Counts a stat up from zero when it scrolls into view. */
export function Counter({
  value,
  className = "",
  duration = 1300,
}: {
  value: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const parsed = parse(value);
  const [display, setDisplay] = useState(
    parsed ? `${parsed.prefix}${(0).toFixed(parsed.decimals)}${parsed.suffix}` : value,
  );

  useEffect(() => {
    if (!parsed) return;
    const el = ref.current;
    if (!el) return;
    const final = `${parsed.prefix}${parsed.target.toFixed(parsed.decimals)}${parsed.suffix}`;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(final);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setDisplay(`${parsed.prefix}${(parsed.target * eased).toFixed(parsed.decimals)}${parsed.suffix}`);
          if (t < 1) requestAnimationFrame(tick);
          else setDisplay(final);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
