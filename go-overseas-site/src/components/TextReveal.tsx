"use client";

import { useEffect, useRef, useState, type ElementType } from "react";

type Word = { t: string; className?: string };

/** Word-by-word clip reveal that triggers when it scrolls into view. */
export function TextReveal({
  words,
  className = "",
  as: Tag = "span",
}: {
  words: Word[];
  className?: string;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref as React.Ref<HTMLElement>} className={className}>
      {words.map((w, i) => (
        <span key={i} className="tr-word">
          <span
            className={`tr-inner ${w.className ?? ""}`}
            data-in={shown}
            style={{ transitionDelay: `${i * 55}ms` }}
          >
            {w.t}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}
