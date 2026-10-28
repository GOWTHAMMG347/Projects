import { api, session, requireAuth, errorMessage, pct, fmtDuration } from "./api.js";
import { mountHeader, toast } from "./shell.js";

requireAuth();
mountHeader("video");

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 200 * 1024 * 1024;
const EXT = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;
const mb = (n) => (n / 1048576).toFixed(1);

let file = null;
let localUrl = null;
let jobId = null;
let job = null;
let media = null;
let pollTimer = null;
let xhr = null;
let processingSince = 0;
let version = "det";

// ---------- settings ----------
for (const id of ["conf", "iou"]) {
  $(id).addEventListener("input", () => ($(`${id}-out`).textContent = Number($(id).value).toFixed(2)));
}

// ---------- file selection ----------
const drop = $("drop");
drop.addEventListener("click", () => $("file").click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); }
});
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
drop.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));
$("file").addEventListener("change", (e) => setFile(e.target.files[0]));

function setFile(f) {
  if (!f) return;
  if (!EXT.test(f.name)) return toast("Choose an MP4, MOV, AVI, MKV or WEBM video.", "error");
  if (f.size > MAX_BYTES) return toast("That video is over 200 MB. Trim or compress it first.", "error");
  file = f;
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = URL.createObjectURL(f);
  $("file-name").textContent = `${f.name} (${mb(f.size)} MB)`;
  resetResults();
  setPlayer(localUrl);
  $("run").disabled = false;
}

function setPlayer(src, poster) {
  $("empty").hidden = true;
  $("player-error").hidden = true;
  const p = $("player");
  p.hidden = false;
  if (poster) p.poster = poster; else p.removeAttribute("poster");
  p.src = src;
}
$("player").addEventListener("error", () => {
  if ($("player").src) $("player-error").hidden = false;
});

function resetResults() {
  $("results").hidden = true;
  $("seg").hidden = true;
  $("download").hidden = true;
  $("csv").hidden = true;
  $("job").hidden = true;
  media = null; job = null; jobId = null;
  history.replaceState(null, "", location.pathname);
}

// ---------- job panel ----------
function setJob(label, progress, meta, { indeterminate = false, cancellable = true } = {}) {
  $("job").hidden = false;
  $("job-label").textContent = label;
  const p = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  $("job-pct").textContent = indeterminate ? "" : `${p}%`;
  $("bar").classList.toggle("indeterminate", indeterminate);
  $("bar").setAttribute("aria-valuenow", indeterminate ? "" : p);
  $("bar").firstElementChild.style.width = indeterminate ? "" : `${p}%`;
  $("job-meta").textContent = meta || "";
  $("cancel").hidden = !cancellable;
  $("status").textContent = `${label} ${indeterminate ? "" : p + "%"}`;
}

function idle() {
  $("run").disabled = !file;
  $("run").textContent = "Process video";
}

// ---------- upload ----------
function upload() {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("conf", $("conf").value);
    form.append("iou", $("iou").value);
    form.append("imgsz", $("imgsz").value);
    form.append("stride", $("stride").value);
    form.append("track", $("track").checked ? "true" : "false");
    if ($("um").value) form.append("um_per_px", $("um").value);

    xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setJob("Uploading video", e.loaded / e.total, `${mb(e.loaded)} of ${mb(e.total)} MB`);
    };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status === 401) { session.clear(); location.replace("/login.html?expired=1"); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(errorMessage(body, xhr.status)));
    };
    xhr.onerror = () => reject(new Error("Can't reach the server. Check your connection and try again."));
    xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled."), { cancelled: true }));
    xhr.send(form);
  });
}

$("run").addEventListener("click", async () => {
  if (!file) return;
  const keep = file;
  resetResults();
  file = keep;
  $("run").disabled = true;
  $("run").innerHTML = '<span class="spinner"></span> Working';
  setJob("Uploading video", 0, "");
  try {
    job = await upload();
    xhr = null;
    jobId = job.id;
    history.replaceState(null, "", `?id=${jobId}`);
    startPolling();
  } catch (err) {
    xhr = null;
    $("job").hidden = true;
    if (!err.cancelled) toast(err.message, "error");
    idle();
  }
});

$("cancel").addEventListener("click", async () => {
  $("cancel").disabled = true;
  try {
    if (xhr) xhr.abort();
    else if (jobId) await api(`/videos/${jobId}/cancel`, { method: "POST" });
  } catch (e) { toast(e.message, "error"); }
  $("cancel").disabled = false;
});

// ---------- polling ----------
function startPolling() {
  stopPolling();
  processingSince = 0;
  tick();
  pollTimer = setInterval(tick, 1000);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

async function tick() {
  let j;
  try { j = await api(`/videos/${jobId}`); }
  catch (e) { stopPolling(); toast(e.message, "error"); idle(); return; }
  job = j;

  if (j.status === "queued") {
    setJob("Waiting in line", 0, "Another video is being processed first.", { indeterminate: true });
  } else if (j.status === "processing") {
    if (!processingSince) processingSince = Date.now();
    const known = j.total_frames > 0;
    let meta = `${j.processed_frames} frames analysed`;
    const elapsed = (Date.now() - processingSince) / 1000;
    if (known && j.progress > 0.03) meta += ` · about ${fmtDuration((elapsed * (1 - j.progress)) / j.progress)} left`;
    setJob("Analysing frames", j.progress, meta, { indeterminate: !known || j.progress === 0 && j.processed_frames === 0 });
  } else if (j.status === "done") {
    stopPolling();
    await finish(j);
  } else if (j.status === "failed") {
    stopPolling();
    setJob("Processing failed", 0, j.error || "Something went wrong.", { cancellable: false });
    $("bar").classList.remove("indeterminate");
    idle();
  } else if (j.status === "cancelled") {
    stopPolling();
    setJob("Cancelled", 0, "Processing was stopped.", { cancellable: false });
    idle();
  }
}

// ---------- results ----------
async function finish(j) {
  try {
    media = await api(`/videos/${j.id}/media`);
  } catch (e) { toast(e.message, "error"); idle(); return; }
  $("job").hidden = true;
  idle();
  version = "det";
  setPlayer(media.result, media.poster);
  $("seg").hidden = false;
  updateSeg();
  const dl = $("download");
  dl.hidden = false;
  dl.href = media.result;
  dl.download = `detected-${j.filename.replace(/\.[^.]+$/, "")}.mp4`;
  $("csv").hidden = false;
  renderStats(j);
  drawChart(j);
  $("status").textContent = "Video processed.";
}

function renderStats(j) {
  $("results").hidden = false;
  if (j.tracked && j.unique_count != null) {
    $("s-unique").textContent = j.unique_count;
    $("s-unique-note").textContent = "seen in 3+ frames";
  } else {
    $("s-unique").textContent = "n/a";
    $("s-unique-note").textContent = "Tracking was off or unavailable";
  }
  $("s-max").textContent = j.max_per_frame;
  const peak = j.timeline.find((p) => p[1] === j.max_per_frame);
  $("s-max-at").textContent = peak && j.max_per_frame > 0 ? `at ${fmtDuration(peak[0] / j.fps)}` : "";
  $("s-avg").textContent = j.avg_per_frame.toFixed(1);
  $("s-conf").textContent = j.max_per_frame ? pct(j.avg_confidence) : "n/a";
  $("s-time").textContent = `Processed in ${fmtDuration(j.processing_s)}`;
  $("settings-line").textContent =
    `${fmtDuration(j.duration_s)} · ${j.width} × ${j.height} px · ${j.fps.toFixed(0)} fps · ` +
    `every ${j.stride === 1 ? "frame" : j.stride + (j.stride === 2 ? "nd" : j.stride === 3 ? "rd" : "th") + " frame"} · ` +
    `confidence ${j.conf_threshold.toFixed(2)} · ${j.imgsz} px`;
}

// ---------- original / detected switch ----------
function updateSeg() {
  $("seg-det").setAttribute("aria-pressed", String(version === "det"));
  $("seg-orig").setAttribute("aria-pressed", String(version === "orig"));
}
function switchTo(v) {
  if (!media || v === version) return;
  const p = $("player");
  const t = p.currentTime, wasPlaying = !p.paused;
  version = v;
  updateSeg();
  $("player-error").hidden = true;
  p.addEventListener("loadedmetadata", () => {
    p.currentTime = t;
    if (wasPlaying) p.play().catch(() => {});
  }, { once: true });
  p.src = v === "det" ? media.result : media.original;
}
$("seg-det").addEventListener("click", () => switchTo("det"));
$("seg-orig").addEventListener("click", () => switchTo("orig"));

// ---------- chart ----------
const W = 800, H = 200, L = 36, R = 12, T = 10, B = 26;
let chartDur = 1;

function drawChart(j) {
  const tl = j.timeline;
  chartDur = Math.max(0.1, j.duration_s || (tl.length ? tl[tl.length - 1][0] / j.fps : 1));
  const maxC = tl.reduce((m, p) => Math.max(m, p[1]), 1);
  const x = (t) => L + (t / chartDur) * (W - L - R);
  const y = (c) => T + (1 - c / maxC) * (H - T - B);

  // Reduce to at most one point per ~pixel column, keeping the peak of each bucket.
  const buckets = new Map();
  for (const [f, c] of tl) {
    const key = Math.round(x(f / j.fps));
    if (!buckets.has(key) || buckets.get(key)[1] < c) buckets.set(key, [f, c]);
  }
  const pts = [...buckets.values()].sort((a, b) => a[0] - b[0]);
  const line = pts.map(([f, c], i) => `${i ? "L" : "M"}${x(f / j.fps).toFixed(1)},${y(c).toFixed(1)}`).join("");
  const area = pts.length ? `${line}L${x(pts[pts.length - 1][0] / j.fps).toFixed(1)},${y(0)}L${x(pts[0][0] / j.fps).toFixed(1)},${y(0)}Z` : "";

  let ticks = "";
  const yTicks = maxC >= 4 ? [0, Math.round(maxC / 2), maxC] : [...new Set([0, maxC])];
  for (const c of yTicks) {
    ticks += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(c)}" y2="${y(c)}"/><text x="${L - 6}" y="${y(c) + 4}" text-anchor="end">${c}</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const t = (chartDur * i) / 4;
    ticks += `<text x="${x(t)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${fmtDuration(t)}</text>`;
  }
  $("chart").innerHTML =
    `${ticks}<path class="area" d="${area}"/><path class="line" d="${line}"/>` +
    `<line class="cursor" id="cursor" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
}

function seekFromEvent(e) {
  const svg = $("chart");
  const r = svg.getBoundingClientRect();
  const sx = ((e.clientX - r.left) / r.width) * W;
  const t = Math.max(0, Math.min(chartDur, ((sx - L) / (W - L - R)) * chartDur));
  const p = $("player");
  if (isFinite(t)) p.currentTime = t;
}
const chart = $("chart");
chart.setAttribute("tabindex", "0");
chart.addEventListener("pointerdown", (e) => { chart.setPointerCapture(e.pointerId); seekFromEvent(e); });
chart.addEventListener("pointermove", (e) => { if (e.buttons) seekFromEvent(e); });
chart.addEventListener("keydown", (e) => {
  const p = $("player");
  if (e.key === "ArrowRight") { p.currentTime += 1; e.preventDefault(); }
  if (e.key === "ArrowLeft") { p.currentTime = Math.max(0, p.currentTime - 1); e.preventDefault(); }
});
$("player").addEventListener("timeupdate", () => {
  const c = document.getElementById("cursor");
  if (!c || !job) return;
  const px = L + (Math.min($("player").currentTime, chartDur) / chartDur) * (W - L - R);
  c.setAttribute("x1", px); c.setAttribute("x2", px);
});

// ---------- CSV ----------
$("csv").addEventListener("click", () => {
  if (!job) return;
  const lines = ["frame,time_s,particles"];
  for (const [f, c] of job.timeline) lines.push(`${f},${(f / job.fps).toFixed(3)},${c}`);
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `video-${job.id}-particles.csv`; a.click();
  URL.revokeObjectURL(url);
});

// ---------- resume from History (?id=) ----------
const resumeId = new URLSearchParams(location.search).get("id");
if (resumeId && /^\d+$/.test(resumeId)) {
  jobId = Number(resumeId);
  $("empty").hidden = true;
  $("run").disabled = true;
  startPolling();
}
window.addEventListener("pagehide", stopPolling);
