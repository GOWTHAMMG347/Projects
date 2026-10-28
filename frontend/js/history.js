import { api, imageUrl, requireAuth, fmtDate, fmtDuration, pct } from "./api.js";
import { mountHeader, toast } from "./shell.js";

requireAuth();
mountHeader("history");

const $ = (id) => document.getElementById(id);
const PAGE = 24;
let offset = 0;
let openItem = null;
const urls = []; // object URLs to release

async function loadStats() {
  const s = await api("/stats");
  $("stats").hidden = s.analyses === 0;
  $("h-n").textContent = s.analyses;
  $("h-total").textContent = s.total_particles;
  $("h-avg").textContent = s.avg_per_image;
  $("h-conf").textContent = s.analyses ? pct(s.avg_confidence) : "n/a";
  $("empty").hidden = s.analyses > 0;
}

function card(d) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "item";
  b.dataset.id = d.id;
  b.innerHTML = `
    <span class="thumb"></span>
    <span class="item-body">
      <strong></strong>
      <span class="row"><span class="count-badge"></span><span class="when"></span></span>
    </span>`;
  b.querySelector("strong").textContent = d.filename;
  b.querySelector(".count-badge").textContent = `${d.count} particle${d.count === 1 ? "" : "s"}`;
  b.querySelector(".when").textContent = fmtDate(d.created_at);
  b.addEventListener("click", () => openDialog(d));
  // Thumbnails need the auth header, so they're fetched and shown as blob URLs.
  imageUrl(d.id, "result").then((u) => {
    urls.push(u);
    const img = new Image();
    img.alt = `Detection result for ${d.filename}`;
    img.loading = "lazy";
    img.src = u;
    b.querySelector(".thumb").append(img);
  }).catch(() => {});
  return b;
}

async function loadPage() {
  const items = await api(`/detections?limit=${PAGE}&offset=${offset}`);
  items.forEach((d) => $("grid").append(card(d)));
  offset += items.length;
  $("more").hidden = items.length < PAGE;
}

// ---------- detail dialog ----------
const dlg = $("dlg");
let dlgUrls = { result: null, original: null };

async function openDialog(d) {
  openItem = d;
  $("dlg-title").textContent = d.filename;
  $("dlg-meta").textContent = `${fmtDate(d.created_at)} · ${d.width} × ${d.height} px`;
  $("d-count").textContent = d.count;
  $("d-conf").textContent = d.count ? pct(d.avg_confidence) : "n/a";
  $("d-cov").textContent = `${d.coverage_pct.toFixed(2)}%`;
  $("d-set").textContent = `conf ${d.conf_threshold.toFixed(2)} · ${d.imgsz}px`;

  const calibrated = d.um_per_px != null;
  $("d-um-h").hidden = !calibrated;
  const rows = $("d-rows");
  rows.replaceChildren();
  for (const p of d.particles) {
    const tr = document.createElement("tr");
    const cells = [`#${p.index}`, pct(p.confidence), p.longest_px];
    if (calibrated) cells.push(p.longest_um);
    cells.forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.append(td); });
    rows.append(tr);
  }

  $("dlg-toggle").checked = true;
  $("dlg-img").removeAttribute("src");
  dlgUrls = { result: null, original: null };
  dlg.showModal();
  try {
    dlgUrls.result = await imageUrl(d.id, "result");
    $("dlg-img").src = dlgUrls.result;
    $("dlg-img").alt = `Detection result: ${d.count} particles marked`;
  } catch (e) { toast(e.message, "error"); }
}

$("dlg-toggle").addEventListener("change", async (e) => {
  const kind = e.target.checked ? "result" : "original";
  try {
    if (!dlgUrls[kind]) dlgUrls[kind] = await imageUrl(openItem.id, kind);
    $("dlg-img").src = dlgUrls[kind];
  } catch (err) { toast(err.message, "error"); }
});

$("dlg-close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("close", () => {
  Object.values(dlgUrls).forEach((u) => u && URL.revokeObjectURL(u));
  dlgUrls = { result: null, original: null };
});

$("dlg-del").addEventListener("click", async () => {
  if (!openItem || !confirm(`Delete the analysis of "${openItem.filename}"? This can't be undone.`)) return;
  try {
    await api(`/detections/${openItem.id}`, { method: "DELETE" });
    document.querySelector(`.item[data-id="${openItem.id}"]`)?.remove();
    dlg.close();
    toast("Analysis deleted.");
    offset = Math.max(0, offset - 1);
    await loadStats();
  } catch (e) { toast(e.message, "error"); }
});

$("more").addEventListener("click", () => loadPage().catch((e) => toast(e.message, "error")));

Promise.all([loadStats(), loadPage()]).catch((e) => toast(e.message, "error"));
window.addEventListener("pagehide", () => urls.forEach((u) => URL.revokeObjectURL(u)));


// ================= Videos tab =================
let vOffset = 0;
let vLoaded = false;

function videoCard(v) {
  const a = document.createElement("a");
  a.className = "item";
  a.href = `/video.html?id=${v.id}`;
  a.style.textDecoration = "none";
  a.innerHTML = `
    <span class="thumb"><span class="play-badge"></span></span>
    <span class="item-body">
      <strong></strong>
      <span class="row"><span class="vstat"></span><span class="when"></span></span>
    </span>`;
  a.querySelector("strong").textContent = v.filename;
  a.querySelector(".when").textContent = fmtDate(v.created_at);
  a.querySelector(".play-badge").textContent = v.duration_s ? fmtDuration(v.duration_s) : "video";

  const stat = a.querySelector(".vstat");
  if (v.status === "done") {
    stat.className = "vstat count-badge";
    stat.textContent = v.unique_count != null
      ? `${v.unique_count} unique particle${v.unique_count === 1 ? "" : "s"}`
      : `Peak ${v.max_per_frame} per frame`;
  } else {
    const labels = { queued: "Queued", processing: `Processing ${Math.round(v.progress * 100)}%`, failed: "Failed", cancelled: "Cancelled" };
    stat.className = `badge ${v.status}`;
    stat.textContent = labels[v.status] || v.status;
  }

  api(`/videos/${v.id}/file?kind=poster`, { raw: true })
    .then(async (res) => {
      const u = URL.createObjectURL(await res.blob());
      urls.push(u);
      const img = new Image();
      img.alt = "";
      img.loading = "lazy";
      img.src = u;
      a.querySelector(".thumb").prepend(img);
    })
    .catch(() => {});
  return a;
}

async function loadVideos() {
  const items = await api(`/videos?limit=${PAGE}&offset=${vOffset}`);
  items.forEach((v) => $("vgrid").append(videoCard(v)));
  vOffset += items.length;
  vLoaded = true;
  $("vmore").hidden = items.length < PAGE;
  $("vempty").hidden = vOffset > 0;
}
$("vmore").addEventListener("click", () => loadVideos().catch((e) => toast(e.message, "error")));

// ================= Tabs =================
function selectTab(name) {
  const videos = name === "videos";
  $("tab-images").setAttribute("aria-selected", String(!videos));
  $("tab-videos").setAttribute("aria-selected", String(videos));
  $("panel-images").hidden = videos;
  $("panel-videos").hidden = !videos;
  const btn = $("new-btn");
  btn.href = videos ? "/video.html" : "/analyze.html";
  btn.textContent = videos ? "New video analysis" : "New image analysis";
  history.replaceState(null, "", videos ? "#videos" : "#images");
  if (videos && !vLoaded) loadVideos().catch((e) => toast(e.message, "error"));
}
$("tab-images").addEventListener("click", () => selectTab("images"));
$("tab-videos").addEventListener("click", () => selectTab("videos"));
if (location.hash === "#videos") selectTab("videos");
