import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Job } from "../types";

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [active, setActive] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; message: string }>({ pct: 0, message: "" });
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await api.listJobs());
    } catch {
      /* ignore transient errors */
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  }, []);

  const track = useCallback(
    (jobId: string) => {
      setBusy(true);
      stopPolling();
      const tick = async () => {
        let job: Job;
        try {
          job = await api.getJob(jobId);
        } catch {
          stopPolling();
          return;
        }
        setProgress({ pct: (job.progress || 0) * 100, message: job.message || job.status });
        await refresh();
        if (job.status === "done") {
          stopPolling();
          setBusy(false);
          setActive(job);
        } else if (job.status === "error") {
          stopPolling();
          setBusy(false);
        }
      };
      poll.current = setInterval(tick, 800);
      void tick();
    },
    [refresh, stopPolling],
  );

  const open = useCallback(
    async (jobId: string) => {
      const job = await api.getJob(jobId);
      if (job.status === "done") setActive(job);
      else track(jobId);
    },
    [track],
  );

  const rename = useCallback(
    async (jobId: string, name: string) => {
      await api.renameJob(jobId, name);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (jobId: string) => {
      await api.deleteJob(jobId);
      setActive((cur) => (cur?.id === jobId ? null : cur));
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    // Async list fetch on mount; setState happens inside the promise.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return stopPolling;
  }, [refresh, stopPolling]);

  return { jobs, active, busy, progress, refresh, track, open, rename, remove };
}
