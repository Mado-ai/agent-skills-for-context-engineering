import type { Job, PlayerProfile, TeamProfile, TeamSummary, User } from "../types";

const TOKEN_KEY = "pm_token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.detail || `Request failed (${res.status})`);
  return data;
}

function authHeaders(): HeadersInit {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Authenticated JSON request helper (merges auth header, parses + throws).
async function authed(path: string, opts: RequestInit = {}) {
  return parse(
    await fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } }),
  );
}

export const api = {
  async register(email: string, password: string): Promise<{ token: string; email: string }> {
    return parse(
      await fetch("/api/auth/register", { method: "POST", body: new URLSearchParams({ email, password }) }),
    );
  },

  async login(email: string, password: string): Promise<{ token: string; email: string }> {
    return parse(
      await fetch("/api/auth/login", { method: "POST", body: new URLSearchParams({ email, password }) }),
    );
  },

  async me(): Promise<User> {
    return parse(await fetch("/api/auth/me", { headers: authHeaders() }));
  },

  async listJobs(): Promise<Job[]> {
    const data = await parse(await fetch("/api/jobs", { headers: authHeaders() }));
    return data.jobs as Job[];
  },

  async getJob(id: string): Promise<Job> {
    return parse(await fetch(`/api/jobs/${id}`, { headers: authHeaders() }));
  },

  async renameJob(id: string, name: string): Promise<void> {
    await parse(
      await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: new URLSearchParams({ name }),
      }),
    );
  },

  async deleteJob(id: string): Promise<void> {
    await parse(await fetch(`/api/jobs/${id}`, { method: "DELETE", headers: authHeaders() }));
  },

  async changePassword(current_password: string, new_password: string): Promise<void> {
    await parse(
      await fetch("/api/auth/change-password", {
        method: "POST",
        headers: authHeaders(),
        body: new URLSearchParams({ current_password, new_password }),
      }),
    );
  },

  async createJob(file: File, detector: string): Promise<{ job_id: string }> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("detector", detector);
    return parse(await fetch("/api/jobs", { method: "POST", headers: authHeaders(), body: fd }));
  },

  async createDemo(seconds: number, detector: string): Promise<{ job_id: string }> {
    const fd = new FormData();
    fd.append("seconds", String(seconds));
    fd.append("detector", detector);
    return parse(await fetch("/api/demo", { method: "POST", headers: authHeaders(), body: fd }));
  },

  // Media tags can't send headers — token goes in the query string.
  fileUrl(jobId: string, path: string): string {
    return `/api/files/${jobId}/${path}?token=${encodeURIComponent(tokenStore.get() ?? "")}`;
  },

  // --- teams / players / matches ---
  async listTeams(): Promise<TeamSummary[]> {
    return (await authed("/api/teams")).teams as TeamSummary[];
  },
  async createTeam(name: string): Promise<{ id: string }> {
    return authed("/api/teams", { method: "POST", body: new URLSearchParams({ name }) });
  },
  async getTeam(id: string): Promise<TeamProfile> {
    return authed(`/api/teams/${id}`);
  },
  async deleteTeam(id: string): Promise<void> {
    await authed(`/api/teams/${id}`, { method: "DELETE" });
  },
  async shareTeam(id: string): Promise<{ public: boolean; public_token: string | null }> {
    return authed(`/api/teams/${id}/share`, { method: "POST" });
  },
  async exportTeam(id: string): Promise<unknown> {
    return authed(`/api/teams/${id}/export`);
  },
  async importTeam(bundle: unknown): Promise<{ team_id: string }> {
    return authed("/api/teams/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    });
  },
  async createPlayer(teamId: string, fields: Record<string, string>): Promise<{ id: string }> {
    return authed(`/api/teams/${teamId}/players`, { method: "POST", body: new URLSearchParams(fields) });
  },
  async getPlayer(id: string): Promise<PlayerProfile> {
    return authed(`/api/players/${id}`);
  },
  async sharePlayer(id: string): Promise<{ public: boolean; public_token: string | null }> {
    return authed(`/api/players/${id}/share`, { method: "POST" });
  },
  async createMatch(teamId: string, fields: Record<string, string>): Promise<{ id: string }> {
    return authed(`/api/teams/${teamId}/matches`, { method: "POST", body: new URLSearchParams(fields) });
  },
  async matchDetected(matchId: string): Promise<{
    detected: { player_id: number; team: string; distance_m: number; top_speed_ms: number }[];
    roster: { id: string; name: string; jersey: number | null }[];
  }> {
    return authed(`/api/matches/${matchId}/detected`);
  },
  async importMatchStats(
    matchId: string,
    mapping: { detected_id: number; player_id: string }[],
    minutes: number,
  ): Promise<{ imported: number }> {
    return authed(`/api/matches/${matchId}/import-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping, minutes }),
    });
  },

  // public (no auth)
  async publicTeam(token: string): Promise<TeamProfile> {
    return parse(await fetch(`/api/public/teams/${token}`));
  },
  async publicPlayer(token: string): Promise<PlayerProfile> {
    return parse(await fetch(`/api/public/players/${token}`));
  },
};

export { ApiError };
