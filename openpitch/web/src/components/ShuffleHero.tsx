import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./ui";

/* Branded shuffle hero (adapted from the shadcn ShuffleHero pattern to our
 * Vite + Tailwind-v4 token system). Tiles try a soccer photo and fall back to
 * an on-brand gradient + motif, so the mosaic always looks designed even if an
 * image is unavailable. */

type IconName = Parameters<typeof Icon>[0]["name"];

const GRADS = [
  "linear-gradient(135deg,#1fb863,#0c3322)",
  "linear-gradient(135deg,#4d7cff,#10204a)",
  "linear-gradient(135deg,#f5b53d,#5a3a07)",
  "linear-gradient(135deg,#a78bfa,#2a1f50)",
  "linear-gradient(135deg,#ff5a5a,#4a1212)",
  "linear-gradient(135deg,#2ee27a,#0a3a22)",
];
const MOTIFS: IconName[] = ["target", "activity", "zap", "route", "trophy", "flame", "chart", "gauge"];

// Soccer imagery (best-effort); the gradient underneath shows if any URL fails.
const PHOTOS = [
  "1551958219-acbc608c6377", "1431324155629-1a6deb1dec8d", "1574629810360-7efbbe195018",
  "1517927033932-b3d18e61fb3a", "1508098682722-e99c43a406b2", "1486286701208-1d58e9338013",
  "1459865264687-595d652de67e", "1579952363873-27f3bade9f55", "1606107557195-0e29a4b5b4aa",
  "1552318965-6e6be7484ada", "1543326727-cf6c39e8f84c", "1522778526097-ce0a22ceb253",
  "1560272564-c83b66b1ad12", "1518604666860-9ed391f76460", "1577223625816-7546f13df25d",
  "1526232761682-d26e85d9fc59",
];

type Tile = { id: number; src: string; grad: string; motif: IconName };

const TILES: Tile[] = PHOTOS.map((p, i) => ({
  id: i + 1,
  src: `https://images.unsplash.com/photo-${p}?auto=format&fit=crop&w=400&q=70`,
  grad: GRADS[i % GRADS.length],
  motif: MOTIFS[i % MOTIFS.length],
}));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ShuffleGrid() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tiles, setTiles] = useState<Tile[]>(() => shuffle(TILES));

  useEffect(() => {
    const loop = () => {
      setTiles(shuffle(TILES));
      timer.current = setTimeout(loop, 3200);
    };
    timer.current = setTimeout(loop, 3200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="grid grid-cols-4 grid-rows-4 gap-1.5 h-[360px] sm:h-[440px]">
      {tiles.map((t) => (
        <motion.div
          key={t.id}
          layout
          transition={{ duration: 1.4, type: "spring" }}
          className="relative overflow-hidden rounded-xl ring-1 ring-inset ring-white/10"
          style={{ background: t.grad }}
        >
          <span className="absolute inset-0 grid place-items-center text-white/20">
            <Icon name={t.motif} width={26} height={26} />
          </span>
          <img
            src={t.src}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        </motion.div>
      ))}
    </div>
  );
}

/** Circle-expand animated CTA (reflects the motion-button example), as a Link. */
export function CtaButton({ to, children, variant = "primary" }: {
  to: string; children: React.ReactNode; variant?: "primary" | "ghost";
}) {
  if (variant === "ghost") {
    return (
      <Link
        to={to}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-5 py-2.5 text-sm font-semibold transition hover:border-line-2"
      >
        {children}
        <Icon name="play" width={15} height={15} />
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className="group relative inline-flex h-12 items-center overflow-hidden rounded-full bg-pitch pl-5 pr-12 text-sm font-semibold text-emerald-950"
    >
      <span className="relative z-10">{children}</span>
      <span className="absolute right-1.5 grid h-9 w-9 place-items-center rounded-full bg-emerald-950/15 transition-all duration-500 ease-out group-hover:w-[calc(100%-0.75rem)] group-hover:bg-emerald-950/20">
        <Icon name="play" width={16} height={16} className="text-emerald-950" />
      </span>
    </Link>
  );
}

const PILLS = ["Auto-production", "Possession & heatmaps", "Distance & speed", "xT & xG", "Auto highlights"];

export default function ShuffleHero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 md:grid-cols-2">
      <div>
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-pitch">
          <span className="h-1.5 w-1.5 rounded-full bg-pitch" /> AI soccer capture & analytics
        </span>
        <h1 className="text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
          See the game like<br />never before.
        </h1>
        <p className="mt-5 max-w-md text-base text-mute md:text-lg">
          One wide camera becomes an auto-produced broadcast <em>and</em> a data room — possession,
          heatmaps, physical metrics, expected threat and xG, with zero operators.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <CtaButton to="/?signup">Start free</CtaButton>
          <CtaButton to="/features" variant="ghost">See features</CtaButton>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {PILLS.map((p) => (
            <span key={p} className="rounded-full border border-line bg-card px-3 py-1.5 text-xs text-mute">
              {p}
            </span>
          ))}
        </div>
      </div>
      <ShuffleGrid />
    </section>
  );
}
