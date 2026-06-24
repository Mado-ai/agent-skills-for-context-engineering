import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { ClipTag, Job, Shape, Telestration } from "../types";
import { Card, Icon } from "./ui";
import { cx } from "../lib/cx";

const COLORS = ["#ffd60a", "#ff5a5a", "#4d7cff", "#2ee27a", "#ffffff"];
const TOOLS = [
  { id: "arrow", label: "Arrow", icon: "route" },
  { id: "line", label: "Line", icon: "activity" },
  { id: "ellipse", label: "Circle", icon: "target" },
  { id: "rect", label: "Box", icon: "shield" },
  { id: "free", label: "Draw", icon: "zap" },
] as const;
type ToolId = (typeof TOOLS)[number]["id"];

const QUICK = ["Goal", "Chance", "Shot", "Press", "Turnover", "Set piece", "Foul", "Save", "Skill"];

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}'${String(Math.round(s % 60)).padStart(2, "0")}"`;
}

/** Film room — telestration drawing over the broadcast plus play-tagging.
 *  One shared <video>; the SVG overlay draws in normalised 0–1 coordinates. */
export default function FilmRoom({ job }: { job: Job }) {
  const hasVideo = job.summary?.broadcast !== false;
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t);
    void v.play().catch(() => {});
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
      <Telestrate job={job} hasVideo={hasVideo} videoRef={videoRef} surfaceRef={surfaceRef} />
      <Coding job={job} onSeek={seek} hasVideo={hasVideo} videoRef={videoRef} />
    </div>
  );
}

/* ---------------- Telestration ---------------- */

function Telestrate({
  job, hasVideo, videoRef, surfaceRef,
}: {
  job: Job;
  hasVideo: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [tool, setTool] = useState<ToolId>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [saved, setSaved] = useState<Telestration[]>([]);
  const [drawing, setDrawing] = useState(false);

  const load = useCallback(() => {
    api.listTelestrations(job.id).then((r) => setSaved(r.telestrations)).catch(() => {});
  }, [job.id]);
  useEffect(() => { load(); }, [load]);

  const pt = (e: React.PointerEvent) => {
    const el = surfaceRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { x, y } = pt(e);
    setDrawing(true);
    setDraft(tool === "free"
      ? { kind: "free", points: [x, y], color }
      : { kind: tool, x1: x, y1: y, x2: x, y2: y, color });
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing || !draft) return;
    const { x, y } = pt(e);
    setDraft(draft.kind === "free"
      ? { ...draft, points: [...draft.points, x, y] }
      : { ...draft, x2: x, y2: y });
  };
  const up = () => {
    if (draft) setShapes((s) => [...s, draft]);
    setDraft(null);
    setDrawing(false);
  };

  const undo = () => setShapes((s) => s.slice(0, -1));
  const clear = () => { setShapes([]); setDraft(null); };

  const save = async () => {
    if (shapes.length === 0) return;
    const name = prompt("Name this telestration", `Frame ${fmt(videoRef.current?.currentTime ?? 0)}`);
    if (name === null) return;
    await api.addTelestration(job.id, { name: name || "Untitled", t: videoRef.current?.currentTime ?? 0, shapes });
    clear();
    load();
  };

  const open = (tel: Telestration) => {
    setShapes(tel.shapes);
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, tel.t);
  };
  const del = async (id: string) => { await api.deleteTelestration(id); load(); };

  const all = draft ? [...shapes, draft] : shapes;

  return (
    <Card title="Telestration" subtitle="Pause, draw on the play, then save" icon="film" pad={false}>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {TOOLS.map((t) => (
          <button key={t.id} onClick={() => setTool(t.id)} title={t.label}
            className={cx("grid h-8 w-8 place-items-center rounded-lg transition",
              tool === t.id ? "bg-pitch/20 text-pitch" : "text-mute hover:bg-white/5 hover:text-slate-200")}>
            <Icon name={t.icon} width={15} height={15} />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} title="color"
            className={cx("h-6 w-6 rounded-full ring-2 transition", color === c ? "ring-white" : "ring-transparent")}
            style={{ background: c }} />
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <button onClick={undo} className="rounded-lg px-2 py-1 text-xs text-mute hover:text-white">Undo</button>
        <button onClick={clear} className="rounded-lg px-2 py-1 text-xs text-mute hover:text-white">Clear</button>
        <button onClick={save} disabled={!shapes.length}
          className="ml-auto rounded-lg bg-pitch px-3 py-1.5 text-xs font-semibold text-emerald-950 disabled:opacity-40">
          Save
        </button>
      </div>

      {/* drawing surface */}
      <div ref={surfaceRef} className="relative aspect-video w-full touch-none bg-black">
        {hasVideo ? (
          <video ref={videoRef} key={job.id} src={api.fileUrl(job.id, "broadcast.mp4")} controls
            className="absolute inset-0 h-full w-full" />
        ) : (
          <PitchBackdrop />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
          <defs>
            {COLORS.map((c) => (
              <marker key={c} id={`ah-${c.slice(1)}`} markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill={c} />
              </marker>
            ))}
          </defs>
          {all.map((sh, i) => <ShapeEl key={i} sh={sh} />)}
        </svg>
        {!hasVideo && (
          <span className="absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[0.65rem] text-slate-300">
            No broadcast — drawing on a tactics board
          </span>
        )}
      </div>

      {/* saved list */}
      <div className="border-t border-line px-3 py-2.5">
        {saved.length === 0 ? (
          <p className="text-xs text-mute">No saved telestrations yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {saved.map((tel) => (
              <span key={tel.id} className="group flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 py-1 pl-2.5 pr-1 text-xs">
                <button onClick={() => open(tel)} className="font-medium hover:text-pitch">
                  {tel.name} <span className="text-mute">· {fmt(tel.t)}</span>
                </button>
                <button onClick={() => del(tel.id)} className="grid h-5 w-5 place-items-center rounded text-mute hover:bg-home/15 hover:text-home">×</button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function ShapeEl({ sh }: { sh: Shape }) {
  const stroke = sh.color;
  const common = { stroke, strokeWidth: 0.6, fill: "none", vectorEffect: "non-scaling-stroke" as const, strokeLinecap: "round" as const };
  if (sh.kind === "free")
    return <polyline points={sh.points.reduce<string[]>((a, v, i) => { if (i % 2 === 0) a.push(`${v * 100},${sh.points[i + 1] * 100}`); return a; }, []).join(" ")} {...common} />;
  if (sh.kind === "arrow")
    return <line x1={sh.x1 * 100} y1={sh.y1 * 100} x2={sh.x2 * 100} y2={sh.y2 * 100} {...common} markerEnd={`url(#ah-${stroke.slice(1)})`} />;
  if (sh.kind === "line")
    return <line x1={sh.x1 * 100} y1={sh.y1 * 100} x2={sh.x2 * 100} y2={sh.y2 * 100} {...common} />;
  if (sh.kind === "rect") {
    const x = Math.min(sh.x1, sh.x2) * 100, y = Math.min(sh.y1, sh.y2) * 100;
    return <rect x={x} y={y} width={Math.abs(sh.x2 - sh.x1) * 100} height={Math.abs(sh.y2 - sh.y1) * 100} {...common} />;
  }
  // ellipse
  return <ellipse cx={(sh.x1 + sh.x2) / 2 * 100} cy={(sh.y1 + sh.y2) / 2 * 100}
    rx={Math.abs(sh.x2 - sh.x1) / 2 * 100} ry={Math.abs(sh.y2 - sh.y1) / 2 * 100} {...common} />;
}

function PitchBackdrop() {
  return (
    <svg viewBox="0 0 100 56" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <rect width="100" height="56" fill="#0f1a12" />
      <g stroke="#2b3543" strokeWidth="0.3" fill="none">
        <rect x="1" y="1" width="98" height="54" />
        <line x1="50" y1="1" x2="50" y2="55" />
        <circle cx="50" cy="28" r="8" />
        <rect x="1" y="16" width="12" height="24" />
        <rect x="87" y="16" width="12" height="24" />
      </g>
    </svg>
  );
}

/* ---------------- Coding / tagging ---------------- */

function Coding({
  job, onSeek, hasVideo, videoRef,
}: {
  job: Job;
  onSeek: (t: number) => void;
  hasVideo: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [tags, setTags] = useState<ClipTag[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  const load = useCallback(() => {
    api.listTags(job.id).then((r) => setTags(r.tags)).catch(() => {});
  }, [job.id]);
  useEffect(() => { load(); }, [load]);

  const tag = async (label: string) => {
    const t = videoRef.current?.currentTime ?? 0;
    await api.addTag(job.id, { t, label });
    load();
  };
  const addCustom = async () => {
    const l = custom.trim();
    if (!l) return;
    setCustom("");
    await api.addTag(job.id, { t: videoRef.current?.currentTime ?? 0, label: l });
    load();
  };
  const del = async (id: string) => { await api.deleteTag(id); load(); };

  const labels = Array.from(new Set(tags.map((t) => t.label)));
  const shown = filter ? tags.filter((t) => t.label === filter) : tags;

  return (
    <Card title="Coding" subtitle="Tag moments — click to jump the video" icon="target" pad={false}>
      <div className="border-b border-line p-3">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => tag(q)}
              className="rounded-full border border-line bg-ink-2 px-2.5 py-1 text-xs font-medium hover:border-pitch/60 hover:text-pitch">
              + {q}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input value={custom} onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
            placeholder="Custom tag at current time…"
            className="flex-1 rounded-lg border border-line bg-ink-2 px-3 py-1.5 text-sm outline-none focus:border-pitch/60" />
          <button onClick={addCustom} className="rounded-lg bg-pitch px-3 py-1.5 text-xs font-semibold text-emerald-950">Tag</button>
        </div>
        {!hasVideo && <p className="mt-2 text-[0.7rem] text-mute">Tracking-data report — tags pin to the analysis clock.</p>}
      </div>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          <button onClick={() => setFilter(null)}
            className={cx("rounded-full px-2.5 py-0.5 text-xs", !filter ? "bg-white/10 text-white" : "text-mute hover:text-slate-300")}>
            All {tags.length}
          </button>
          {labels.map((l) => (
            <button key={l} onClick={() => setFilter(l)}
              className={cx("rounded-full px-2.5 py-0.5 text-xs", filter === l ? "bg-white/10 text-white" : "text-mute hover:text-slate-300")}>
              {l} {tags.filter((t) => t.label === l).length}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[26rem] overflow-auto p-2">
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-mute">No tags yet — scrub the video and hit a chip above.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {shown.map((t) => (
              <li key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                <button onClick={() => onSeek(t.t)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <span className="tnum w-12 shrink-0 text-xs font-semibold text-mute">{fmt(t.t)}</span>
                  <span className="truncate text-sm font-medium">{t.label}</span>
                  {t.note && <span className="truncate text-xs text-mute">· {t.note}</span>}
                </button>
                <button onClick={() => del(t.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-mute opacity-0 transition hover:bg-home/15 hover:text-home group-hover:opacity-100">×</button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
