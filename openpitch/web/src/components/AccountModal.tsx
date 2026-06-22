import { useState, type FormEvent } from "react";
import { api } from "../api/client";

export default function AccountModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setPending(true);
    try {
      await api.changePassword(current, next);
      setStatus({ ok: true, msg: "Password updated." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : "Failed" });
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Account</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-line">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-400">
          Signed in as <b className="text-slate-200">{email}</b>
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="rounded-lg border border-line bg-ink p-2.5 text-sm"
          />
          <input
            type="password"
            placeholder="New password (min 6 chars)"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="rounded-lg border border-line bg-ink p-2.5 text-sm"
          />
          <button
            type="submit"
            disabled={pending || !current || !next}
            className="rounded-lg bg-pitch py-2.5 font-semibold text-emerald-950 disabled:opacity-50"
          >
            Change password
          </button>
          {status && (
            <p className={`text-sm ${status.ok ? "text-pitch" : "text-red-400"}`}>{status.msg}</p>
          )}
        </form>
      </div>
    </div>
  );
}
