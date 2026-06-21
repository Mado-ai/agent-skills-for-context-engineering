const $ = (id) => document.getElementById(id);

async function startUpload() {
  const f = $("file").files[0];
  if (!f) return alert("Choose a video file first.");
  const fd = new FormData();
  fd.append("file", f);
  const r = await fetch(`/api/jobs?detector=${$("detector").value}`, {
    method: "POST", body: fd,
  });
  poll((await r.json()).job_id);
}

async function startDemo() {
  const r = await fetch("/api/demo?seconds=10", { method: "POST" });
  poll((await r.json()).job_id);
}

function setBusy(busy) {
  $("upload").disabled = busy;
  $("demo").disabled = busy;
  $("progress").classList.toggle("hidden", !busy);
}

async function poll(jobId) {
  setBusy(true);
  $("results").classList.add("hidden");
  const tick = async () => {
    const job = await (await fetch(`/api/jobs/${jobId}`)).json();
    $("barfill").style.width = `${(job.progress || 0) * 100}%`;
    $("status").textContent = job.message || job.status;
    if (job.status === "done") { setBusy(false); render(jobId, job.summary); return; }
    if (job.status === "error") { setBusy(false); alert("Failed: " + job.message); return; }
    setTimeout(tick, 700);
  };
  tick();
}

function render(jobId, s) {
  const base = `/api/files/${jobId}`;
  $("results").classList.remove("hidden");
  $("broadcast").src = `${base}/broadcast.mp4`;

  // Possession
  const names = Object.keys(s.possession);
  const home = s.possession[names[0]], away = s.possession[names[1]];
  $("poss-home").style.width = `${home}%`;
  $("poss-away").style.width = `${away}%`;
  $("home-name").textContent = names[0];
  $("away-name").textContent = names[1];
  $("home-pct").textContent = `${home}%`;
  $("away-pct").textContent = `${away}%`;

  // Heatmaps
  $("hm-home").src = `${base}/${s.heatmaps[names[0]]}`;
  $("hm-away").src = `${base}/${s.heatmaps[names[1]]}`;

  // Meta
  $("meta").innerHTML = Object.entries(s.meta)
    .map(([k, v]) => `<li><b>${k}</b>: ${v}</li>`).join("");

  // Players
  $("players").querySelector("tbody").innerHTML = s.players
    .map((p) => `<tr><td>${p.player_id}</td><td>${p.team}</td>
      <td>${p.distance_m}</td><td>${p.top_speed_ms}</td></tr>`).join("");

  // Highlights
  $("highlights").innerHTML = s.highlights.length
    ? s.highlights.map((h, i) => `
        <div>
          <div class="hl-meta">#${i + 1} · ${h.start_s}s–${h.end_s}s · intensity ${h.peak_speed}</div>
          <video src="${base}/highlights/${h.clip}" controls></video>
        </div>`).join("")
    : "<p class='muted'>No highlights detected.</p>";
}

$("upload").addEventListener("click", startUpload);
$("demo").addEventListener("click", startDemo);
