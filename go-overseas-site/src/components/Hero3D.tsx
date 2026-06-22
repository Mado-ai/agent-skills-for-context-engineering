"use client";

import dynamic from "next/dynamic";
import { LogoMark } from "./Logo";

// WebGL is client-only and heavy — load it lazily, show the 2D mark until ready.
const HeroMark = dynamic(() => import("./HeroMark"), {
  ssr: false,
  loading: () => (
    <div className="text-white">
      <LogoMark size={148} />
    </div>
  ),
});

export function Hero3D() {
  return <HeroMark height={300} />;
}
