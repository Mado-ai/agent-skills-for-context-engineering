import { useMemo, useState } from "react";
import type { JobSummary } from "../types";
import { api } from "../api/client";
import { cx } from "../lib/cx";
import { Icon } from "./ui";

const HOME = "#ff5a5a";
const AWAY = "#4d7cff";

type Kind = "all" | "shot" | "highlight";

interface Ev {
  t: number;
  kind: "shot" | "highlight";
  team?: string;
  label: string;
  detail: string;
  big?: boolean;
  clip?: string | null;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}'${String(Math.round(s % 60)).padStart(2, "0")}"`;
}

/** Event-linked video: a clickable, filterable match feed. Clicking an event
 *  seeks the broadcast player to that moment; highlight clips open directly. */
export function EventTimeline({
  summary,
  jobId,
  onSeek,
  hasVideo,
}: {
  summary: JobSummary;
  jobId: string;
  onSeek: (t: number) => void;
  hasVideo: boolean;
}) {
  const [filter, setFilter] = useState<Kind>("all");
  const teams = Object.keys(summary.possession);
  const [home] = teams;

  const events = useMemo<Ev[]>(() => {
    const out: Ev[] = [];
    for (const sh of summary.shots ?? []) {
      out.push({
        t: sh.t,
        kind: "shot",
        team: sh.team,
        label: sh.xg >= 0.3 ? "Big chance" : "Shot",
        detail: `${sh.team} · xG ${sh.xg.toFixed(2)}`,
        big: sh.xg >= 0.3,
      });
    }
    (summary.highlights ?? []).forEach((h, i) => {
      out.push({
        t: h.start_s,
        kind: "highlight",
        label: `Highlight #${i + 1}`,
        detail: `intensity ${h.peak_speed}`,
        clip: h.clip,
      });
    });
    return out.sort((a, b) => a.t - b.t);
  }, [summary.shots, summary.highlights]);

  const shown = events.filter((e) => filter === "all" || e.kind === filter);
  const counts = {
    all: events.length,
    shot: events.filter((e) => e.kind === "shot").length,
    highlight: events.filter((e) => e.kind === "highlight").length,
  };

  if (events.length === 0)
    return (
      <p className="py-6 text-center text-sm text-mute">
        No timestamped events yet — shots and highlights appear here once detected on match footage.
      </p>
    );

  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {(["all", "shot", "highlight"] as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cx(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition",
              k === filter ? "bg-white/10 text-white" : "text-mute hover:text-slate-300",
            )}
          >
            {k === "all" ? "All" : k === "shot" ? "Shots" : "Highlights"}
            <span className="ml-1 text-mute">{counts[k]}</span>
          </button>
        ))}
      </div>

      <ol className="relative ml-2 flex flex-col gap-1 border-l border-line pl-4">
        {shown.map((e, i) => {
          const col = e.kind === "highlight" ? "#2ee27a" : e.team === home ? HOME : AWAY;
          return (
            <li key={i} className="relative">
              <span
                className="absolute -left-[1.42rem] top-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-card"
                style={{ background: col }}
              />
              <button
                onClick={() => (e.kind === "highlight" && e.clip ? undefined : onSeek(e.t))}
                disabled={!hasVideo && !(e.kind === "highlight" && e.clip)}
                className={cx(
                  "group flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition",
                  hasVideo || (e.kind === "highlight" && e.clip)
                    ? "hover:bg-white/[0.04]"
                    : "cursor-default opacity-80",
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="tnum w-12 shrink-0 text-xs font-semibold text-mute">{fmt(e.t)}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {e.label}
                      {e.big && (
                        <span className="rounded bg-home/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-home">
                          big
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-mute">{e.detail}</span>
                  </span>
                </span>
                {e.kind === "highlight" && e.clip ? (
                  <a
                    href={api.fileUrl(jobId, `highlights/${e.clip}`)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-mute hover:border-line-2 hover:text-white"
                  >
                    <Icon name="film" width={12} height={12} /> Clip
                  </a>
                ) : hasVideo ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-mute opacity-0 transition group-hover:opacity-100">
                    <Icon name="play" width={12} height={12} /> Jump
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
