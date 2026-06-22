"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "./Logo";

/**
 * Branded intro / preloader. Plays once per session on first load, then the
 * curtain lifts to reveal the site. Skipped entirely under reduced-motion or
 * if already seen this session. The CSS auto-lifts the curtain, so it can never
 * get stuck even if JS is slow.
 */
export function Intro() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || sessionStorage.getItem("introSeen")) {
      setDone(true);
      return;
    }
    sessionStorage.setItem("introSeen", "1");
    const t = setTimeout(() => setDone(true), 2400);
    return () => clearTimeout(t);
  }, []);

  if (done) return null;

  return (
    <div className="intro" aria-hidden="true">
      <div className="intro__inner">
        <div className="intro__logo text-white">
          <LogoMark size={76} />
        </div>
        <div className="intro__word font-display">
          go over<span className="text-blue">seas</span>
        </div>
        <div className="intro__line" />
        <div className="intro__tag">
          <span className="text-blue">Strategy</span> ·{" "}
          <span className="text-purple">Creativity</span> ·{" "}
          <span className="text-green">Growth</span>
        </div>
      </div>
    </div>
  );
}
