import type { Device, Job, Member, Org, PlayerProfile, Site, SiteJob, TeamProfile, TeamSummary, User } from "../types";

const TOKEN_KEY = "pm_token";
let _mediaToken = "";

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

  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
  },

  async authProviders(): Promise<{ id: string; label: string }[]> {
    return (await parse(await fetch("/api/auth/providers"))).providers as { id: string; label: string }[];
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

  // Short-lived, read-only token for media URLs (not the session JWT). Fetched
  // on auth and cached; refreshed lazily.
  async fetchMediaToken(): Promise<void> {
    try {
      _mediaToken = (await authed("/api/auth/media-token")).media_token;
    } catch {
      _mediaToken = "";
    }
  },
  fileUrl(jobId: string, path: string): string {
    return `/api/files/${jobId}/${path}?mt=${encodeURIComponent(_mediaToken)}`;
  },

  // --- organizations / RBAC ---
  async listOrgs(): Promise<Org[]> {
    return (await authed("/api/orgs")).orgs as Org[];
  },
  async createOrg(name: string): Promise<Org> {
    return authed("/api/orgs", { method: "POST", body: new URLSearchParams({ name }) });
  },
  async orgMembers(id: string): Promise<Member[]> {
    return (await authed(`/api/orgs/${id}/members`)).members as Member[];
  },
  async addMember(id: string, fields: Record<string, string>): Promise<void> {
    await authed(`/api/orgs/${id}/members`, { method: "POST", body: new URLSearchParams(fields) });
  },
  async orgTeams(id: string): Promise<TeamSummary[]> {
    return (await authed(`/api/orgs/${id}/teams`)).teams as TeamSummary[];
  },
  async createOrgTeam(id: string, name: string): Promise<{ id: string }> {
    return authed(`/api/orgs/${id}/teams`, { method: "POST", body: new URLSearchParams({ name }) });
  },

  // --- capture sites / devices ---
  async listSites(): Promise<Site[]> {
    return (await authed("/api/sites")).sites as Site[];
  },
  async createSite(name: string, pkg: string): Promise<Site> {
    return authed("/api/sites", { method: "POST", body: new URLSearchParams({ name, package: pkg }) });
  },
  async getSite(id: string): Promise<Site & { devices: Device[] }> {
    return authed(`/api/sites/${id}`);
  },
  async pairDevice(siteId: string, kind: string, name: string): Promise<{ device_id: string; api_key: string }> {
    return authed(`/api/sites/${siteId}/devices`, { method: "POST", body: new URLSearchParams({ kind, name }) });
  },
  async siteMatches(siteId: string): Promise<SiteJob[]> {
    return (await authed(`/api/sites/${siteId}/matches`)).jobs as SiteJob[];
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
  async grantConsent(id: string, granted: boolean): Promise<void> {
    await authed(`/api/players/${id}/consent`, {
      method: "POST",
      body: new URLSearchParams({ granted: String(granted) }),
    });
  },
  async deleteAccount(): Promise<void> {
    await authed("/api/account", { method: "DELETE" });
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
  async autoImportStats(matchId: string): Promise<{ imported: number; matched_side: string }> {
    return authed(`/api/matches/${matchId}/auto-import`, { method: "POST" });
  },

  // public (no auth)
  async packages(): Promise<{
    packages: { id: string; name: string; pitch: string; camera_count: number;
      capture: { name: string; model: string; qty: number; role: string }[] }[];
    edge: { device: string; model: string; role: string }[];
    vlans: { vlan: number; name: string; note: string }[];
    device_kinds: string[];
    device_catalog?: Record<string, { label: string; model: string }>;
  }> {
    return parse(await fetch("/api/packages"));
  },
  async publicTeam(token: string): Promise<TeamProfile> {
    return parse(await fetch(`/api/public/teams/${token}`));
  },
  async publicPlayer(token: string): Promise<PlayerProfile> {
    return parse(await fetch(`/api/public/players/${token}`));
  },
};

export { ApiError };
