// Shared API client + auth-token helpers for Play Metrics.
const API = {
  token: () => localStorage.getItem("pm_token"),
  email: () => localStorage.getItem("pm_email"),
  setSession(token, email) {
    localStorage.setItem("pm_token", token);
    localStorage.setItem("pm_email", email);
  },
  logout() {
    localStorage.removeItem("pm_token");
    localStorage.removeItem("pm_email");
    location.href = "/";
  },

  async form(path, fields) {
    const body = new URLSearchParams(fields);
    const r = await fetch(path, { method: "POST", body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `request failed (${r.status})`);
    return data;
  },

  async authed(path, opts = {}) {
    const token = this.token();
    if (!token) { location.href = "/"; throw new Error("not authenticated"); }
    const r = await fetch(path, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (r.status === 401) { this.logout(); throw new Error("session expired"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `request failed (${r.status})`);
    return data;
  },

  // Build an authenticated URL for media tags (token in query string).
  fileUrl(jobId, path) {
    return `/api/files/${jobId}/${path}?token=${encodeURIComponent(this.token())}`;
  },
};
