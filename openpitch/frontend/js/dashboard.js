// Dashboard: gate on auth, submit jobs, poll, list history, render results.
const $ = (id) => document.getElementById(id);
let activeJob = null;
let pollTimer = null;

async function boot() {
  if (!API.token()) { location.href = "/"; return; }
  try {
    const me = await API.authed("/api/auth/me");
    $("who").textContent = me.email + (me.is_admin ? " · admin" : "");
  } catch { return; }
  await refreshJobs();
}

$("logout").addEventListener("click", () => API.logout());

// --- submit jobs ---
async function processUpload() {
  const f = $("file").files[0];
  if (!f) return alert("Choose a video file first.");
  const fd = new FormData();
  fd.append("file", f);
  fd.append("detector", $("detector").value);
  setBusy(true);
  try {
    const { job_id } = await API.authed("/api/jobs", { method: "POST", body: fd });
    track(job_id);
  } catch (e) { alert(e.message); setBusy(false); }
}

async function runDemo() {
  setBusy(true);
  try {
    const fd = new FormData();
    fd.append("seconds", "10");
    fd.append("detector", $("detector").value);
    const { job_id } = await API.authed("/api/demo", { method: "POST", body: fd });
    track(job_id);
  } catch (e) { alert(e.message); setBusy(false); }
}

function setBusy(b) {
  $("process").disabled = b; $("demo").disabled = b;
  $("progress").classList.toggle("hidden", !b);
}

// --- polling ---
function track(jobId) {
  activeJob = jobId;
  clearInterval(pollTimer);
  pollTimer = setInterval(() => pollOnce(jobId), 800);
  pollOnce(jobId);
}

async function pollOnce(jobId) {
  let job;
  try { job = await API.authed(`/api/jobs/${jobId}`); }
  catch { clearInterval(pollTimer); return; }
  $("barfill").style.width = `${(job.progress || 0) * 100}%`;
  $("status").textContent = job.message || job.status;
  await refreshJobs();
  if (job.status === "done") {
    clearInterval(pollTimer); setBusy(false); render(jobId, job.summary);
  } else if (job.status === "error") {
    clearInterval(pollTimer); setBusy(false);
    alert("Job failed: " + job.message);
  }
}

// --- job history ---
async function refreshJobs() {
  let jobs = [];
  try { jobs = (await API.authed("/api/jobs")).jobs; } catch { return; }
  const list = $("joblist");
  if (!jobs.length) { list.innerHTML = "<p class='muted'>No jobs yet.</p>"; return; }
  list.innerHTML = jobs.map((j) => `
    <div class="jobitem ${j.id === activeJob ? "active" : ""}" data-id="${j.id}">
      <span class="name">${j.input_name || "match"} · ${j.detector}</span>
      <span class="badge ${j.status}">${j.status}</span>
    </div>`).join("");
  list.querySelectorAll(".jobitem").forEach((el) =>
    el.addEventListener("click", () => openJob(el.dataset.id)));
}

async function openJob(jobId) {
  activeJob = jobId;
  const job = await API.authed(`/api/jobs/${jobId}`);
  await refreshJobs();
  if (job.status === "done") render(jobId, job.summary);
  else { track(jobId); }
}

// --- render results ---
function render(jobId, s) {
  if (!s) return;
  $("empty").classList.add("hidden");
  $("results").classList.remove("hidden");
  $("broadcast").src = API.fileUrl(jobId, "broadcast.mp4");

  const names = Object.keys(s.possession);
  const home = s.possession[names[0]], away = s.possession[names[1]];
  $("poss-h").style.width = `${home}%`;
  $("poss-a").style.width = `${away}%`;
  $("home-name").textContent = names[0];
  $("away-name").textContent = names[1];
  $("home-pct").textContent = `${home}%`;
  $("away-pct").textContent = `${away}%`;

  $("hm-home").src = API.fileUrl(jobId, s.heatmaps[names[0]]);
  $("hm-away").src = API.fileUrl(jobId, s.heatmaps[names[1]]);

  $("meta").innerHTML = Object.entries(s.meta)
    .map(([k, v]) => `<li><span class="muted">${k}</span><b>${v}</b></li>`).join("");

  $("players").querySelector("tbody").innerHTML = s.players.map((p) =>
    `<tr><td>${p.player_id}</td><td>${p.team}</td><td>${p.distance_m}</td><td>${p.top_speed_ms}</td></tr>`
  ).join("");

  $("highlights").innerHTML = s.highlights.length
    ? s.highlights.map((h, i) => `
        <div>
          <div class="hl-meta">#${i + 1} · ${h.start_s}s–${h.end_s}s · intensity ${h.peak_speed}</div>
          <video src="${API.fileUrl(jobId, "highlights/" + h.clip)}" controls></video>
        </div>`).join("")
    : "<p class='muted'>No highlights detected.</p>";
}

$("process").addEventListener("click", processUpload);
$("demo").addEventListener("click", runDemo);
boot();
