import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { Card, Icon } from "../components/ui";
import { cx } from "../lib/cx";
import type { Playbook, PlaybookArrow, PlaybookData, PlaybookToken } from "../types";

const HOME = "#ff5a5a";
const AWAY = "#4d7cff";
const BALL = "#ffd60a";

let nextId = 1;
const uid = () => `tk_${Date.now()}_${nextId++}`;

const EMPTY: PlaybookData = { tokens: [], arrows: [], notes: "" };

export default function Playbooks() {
  const { teamId = "" } = useParams();
  const [list, setList] = useState<Playbook[]>([]);
  const [active, setActive] = useState<Playbook | null>(null);

  const load = useCallback(() => {
    api.listPlaybooks(teamId).then((r) => setList(r.playbooks)).catch(() => {});
  }, [teamId]);
  useEffect(() => { load(); }, [load]);

  const newPlay = () =>
    setActive({ id: "", team_id: teamId, name: "New play", field_type: 11, data: structuredClone(EMPTY) });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link to={`/teams/${teamId}`} className="text-sm text-mute hover:text-white">← Team</Link>
      <div className="mb-5 mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Playbook</h1>
        <button onClick={newPlay} className="rounded-xl bg-pitch px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-pitch-dark">
          + New play
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card title="Saved plays" icon="chart">
          {list.length === 0 ? (
            <p className="text-sm text-mute">No plays yet. Create one to start drawing.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {list.map((pb) => (
                <li key={pb.id}>
                  <button onClick={() => setActive(pb)}
                    className={cx("flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition",
                      active?.id === pb.id ? "border-pitch/70 bg-pitch/5" : "border-line hover:border-line-2")}>
                    <span className="truncate font-medium">{pb.name}</span>
                    <span className="text-xs text-mute">{pb.field_type}v{pb.field_type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {active ? (
          <Editor key={active.id || "new"} teamId={teamId} initial={active} onSaved={(pb) => { load(); setActive(pb); }}
            onDeleted={() => { load(); setActive(null); }} />
        ) : (
          <Card className="grid min-h-[420px] place-items-center" pad>
            <div className="text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-pitch/10 text-pitch">
                <Icon name="route" width={22} height={22} />
              </div>
              <p className="text-sm text-mute">Pick a play on the left or create a new one.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

type Mode = "move" | "arrow";

function Editor({ teamId, initial, onSaved, onDeleted }: {
  teamId: string;
  initial: Playbook;
  onSaved: (pb: Playbook) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [fieldType, setFieldType] = useState(initial.field_type);
  const [tokens, setTokens] = useState<PlaybookToken[]>(initial.data.tokens ?? []);
  const [arrows, setArrows] = useState<PlaybookArrow[]>(initial.data.arrows ?? []);
  const [notes, setNotes] = useState(initial.data.notes ?? "");
  const [mode, setMode] = useState<Mode>("move");
  const [sel, setSel] = useState<string | null>(null);
  const [draftArrow, setDraftArrow] = useState<PlaybookArrow | null>(null);
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string } | null>(null);

  const W = 100, H = 64;
  const norm = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
             y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const addToken = (team: PlaybookToken["team"]) => {
    const label = team === "ball" ? "" : team === "home" ? String(tokens.filter((t) => t.team === "home").length + 1) : "X";
    setTokens((s) => [...s, { id: uid(), x: 0.5, y: 0.5, label, team }]);
  };

  const onTokenDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (mode === "arrow") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id };
    setSel(id);
  };

  const onSurfaceDown = (e: React.PointerEvent) => {
    if (mode !== "arrow") { setSel(null); return; }
    const { x, y } = norm(e);
    setDraftArrow({ x1: x, y1: y, x2: x, y2: y });
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = norm(e);
    if (dragRef.current) {
      const id = dragRef.current.id;
      setTokens((s) => s.map((t) => (t.id === id ? { ...t, x, y } : t)));
    } else if (draftArrow) {
      setDraftArrow({ ...draftArrow, x2: x, y2: y });
    }
  };
  const onUp = () => {
    dragRef.current = null;
    if (draftArrow) {
      const d = draftArrow;
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.02) setArrows((s) => [...s, d]);
      setDraftArrow(null);
    }
  };

  const relabel = (id: string) => {
    const cur = tokens.find((t) => t.id === id);
    const v = prompt("Token label", cur?.label ?? "");
    if (v !== null) setTokens((s) => s.map((t) => (t.id === id ? { ...t, label: v.slice(0, 3) } : t)));
  };
  const removeSel = () => {
    if (sel) { setTokens((s) => s.filter((t) => t.id !== sel)); setSel(null); }
  };
  const undoArrow = () => setArrows((s) => s.slice(0, -1));
  const clearAll = () => { setTokens([]); setArrows([]); setSel(null); };

  const save = async () => {
    setSaving(true);
    const data: PlaybookData = { tokens, arrows, notes };
    try {
      if (initial.id) {
        await api.savePlaybook(initial.id, { name, field_type: fieldType, data });
        onSaved({ ...initial, name, field_type: fieldType, data });
      } else {
        const pb = await api.createPlaybook(teamId, { name, field_type: fieldType, data });
        onSaved(pb);
      }
    } finally { setSaving(false); }
  };
  const del = async () => {
    if (!initial.id || !confirm(`Delete "${name}"?`)) return;
    await api.deletePlaybook(initial.id);
    onDeleted();
  };

  const arr = draftArrow ? [...arrows, draftArrow] : arrows;
  const tokColor = (t: PlaybookToken["team"]) => (t === "home" ? HOME : t === "away" ? AWAY : BALL);

  return (
    <Card pad={false}>
      {/* header controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="min-w-[140px] flex-1 rounded-lg border border-line bg-ink-2 px-3 py-1.5 text-sm font-semibold outline-none focus:border-pitch/60" />
        <select value={fieldType} onChange={(e) => setFieldType(+e.target.value)}
          className="rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-sm">
          {[5, 7, 11].map((f) => <option key={f} value={f}>{f}v{f}</option>)}
        </select>
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-pitch px-3 py-1.5 text-sm font-semibold text-emerald-950 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {initial.id && <button onClick={del} className="rounded-lg border border-line px-3 py-1.5 text-sm text-home hover:border-home/60">Delete</button>}
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-xs">
        <button onClick={() => addToken("home")} className="rounded-lg px-2 py-1 font-medium hover:bg-white/5" style={{ color: HOME }}>+ Home</button>
        <button onClick={() => addToken("away")} className="rounded-lg px-2 py-1 font-medium hover:bg-white/5" style={{ color: AWAY }}>+ Opponent</button>
        <button onClick={() => addToken("ball")} className="rounded-lg px-2 py-1 font-medium hover:bg-white/5" style={{ color: BALL }}>+ Ball</button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button onClick={() => setMode("move")}
          className={cx("rounded-lg px-2 py-1 font-medium", mode === "move" ? "bg-pitch/20 text-pitch" : "text-mute hover:text-white")}>Move</button>
        <button onClick={() => setMode("arrow")}
          className={cx("rounded-lg px-2 py-1 font-medium", mode === "arrow" ? "bg-pitch/20 text-pitch" : "text-mute hover:text-white")}>Arrow</button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button onClick={removeSel} disabled={!sel} className="rounded-lg px-2 py-1 text-mute hover:text-white disabled:opacity-40">Delete token</button>
        <button onClick={undoArrow} className="rounded-lg px-2 py-1 text-mute hover:text-white">Undo arrow</button>
        <button onClick={clearAll} className="rounded-lg px-2 py-1 text-mute hover:text-white">Clear</button>
        <span className="ml-auto text-mute">Double-click a token to relabel</span>
      </div>

      {/* pitch */}
      <div className="p-3">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none rounded-xl"
          onPointerDown={onSurfaceDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
          style={{ cursor: mode === "arrow" ? "crosshair" : "default" }}>
          <defs>
            <marker id="pbah" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#e8eef5" />
            </marker>
          </defs>
          <rect x="0" y="0" width={W} height={H} rx="2" fill="#0f1a12" />
          <g stroke="#2b3543" strokeWidth="0.4" fill="none">
            <rect x="1.5" y="1.5" width={W - 3} height={H - 3} />
            <line x1={W / 2} y1="1.5" x2={W / 2} y2={H - 1.5} />
            <circle cx={W / 2} cy={H / 2} r="9.15" />
            <rect x="1.5" y={H / 2 - 20} width="16.5" height="40" />
            <rect x={W - 18} y={H / 2 - 20} width="16.5" height="40" />
          </g>
          {arr.map((a, i) => (
            <line key={i} x1={a.x1 * W} y1={a.y1 * H} x2={a.x2 * W} y2={a.y2 * H}
              stroke="#e8eef5" strokeWidth="0.5" vectorEffect="non-scaling-stroke"
              strokeDasharray={a.dashed ? "2 1.5" : undefined} markerEnd="url(#pbah)" />
          ))}
          {tokens.map((t) => (
            <g key={t.id} transform={`translate(${t.x * W} ${t.y * H})`}
              onPointerDown={(e) => onTokenDown(e, t.id)} onDoubleClick={() => relabel(t.id)}
              style={{ cursor: mode === "move" ? "grab" : "default" }}>
              <circle r={t.team === "ball" ? 1.6 : 2.6} fill={tokColor(t.team)}
                stroke={sel === t.id ? "#fff" : "rgba(0,0,0,.4)"} strokeWidth={sel === t.id ? 0.6 : 0.3} />
              {t.label && <text y="1" fontSize="2.4" fontWeight="700" textAnchor="middle" fill="#0b0f14">{t.label}</text>}
            </g>
          ))}
        </svg>
      </div>

      <div className="border-t border-line p-3">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Coaching notes for this play…"
          className="w-full resize-none rounded-lg border border-line bg-ink-2 px-3 py-2 text-sm outline-none focus:border-pitch/60" />
      </div>
    </Card>
  );
}
