import { api, imageUrl, requireAuth, pct } from "./api.js";
import { mountHeader, toast } from "./shell.js";

requireAuth();
mountHeader("analyze");

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"];

let file = null;
let originalUrl = null;
let resultUrl = null;
let current = null;

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
  if (!TYPES.includes(f.type)) return toast("Choose a JPG, PNG, WEBP, BMP or TIFF image.", "error");
  if (f.size > MAX_BYTES) return toast("That image is over 15 MB. Choose a smaller one.", "error");
  file = f;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(f);
  $("file-name").textContent = `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`;
  showImage(originalUrl, `Uploaded image ${f.name}`);
  $("results").hidden = true;
  for (const id of ["toggle-wrap", "download", "csv"]) $(id).hidden = true;
  $("run").disabled = false;
  resultUrl = null; current = null;
}

function showImage(url, alt) {
  $("empty").hidden = true;
  const img = $("img");
  img.src = url; img.alt = alt; img.hidden = false;
}

// ---------- run detection ----------
$("run").addEventListener("click", async () => {
  if (!file) return;
  const btn = $("run");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analysing';
  $("viewer").classList.add("busy");
  $("status").textContent = "Analysing image";

  const form = new FormData();
  form.append("file", file);
  form.append("conf", $("conf").value);
  form.append("iou", $("iou").value);
  form.append("imgsz", $("imgsz").value);
  if ($("um").value) form.append("um_per_px", $("um").value);

  try {
    current = await api("/detect", { method: "POST", form });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = await imageUrl(current.id, "result");
    $("toggle").checked = true;
    showImage(resultUrl, `Detection result: ${current.count} particles marked`);
    render(current);
    $("status").textContent = `Done. ${current.count} particles found.`;
  } catch (err) {
    toast(err.message, "error");
    $("status").textContent = "Analysis failed.";
  } finally {
    $("viewer").classList.remove("busy");
    btn.disabled = false;
    btn.textContent = "Detect microplastics";
  }
});

function render(d) {
  $("results").hidden = false;
  $("s-count").textContent = d.count;
  $("s-conf").textContent = d.count ? pct(d.avg_confidence) : "n/a";
  $("s-max").textContent = d.count ? `Highest ${pct(d.max_confidence)}` : "";
  $("s-cov").textContent = `${d.coverage_pct.toFixed(2)}%`;
  $("s-ms").textContent = d.inference_ms >= 1000 ? `${(d.inference_ms / 1000).toFixed(1)} s` : `${Math.round(d.inference_ms)} ms`;
  $("s-dim").textContent = `${d.width} × ${d.height} px`;

  $("no-hits").hidden = d.count > 0;
  $("table-wrap").hidden = d.count === 0;
  const calibrated = d.um_per_px != null;
  document.querySelectorAll(".um-col").forEach((c) => (c.hidden = !calibrated));

  const rows = $("rows");
  rows.replaceChildren();
  for (const p of d.particles) {
    const tr = document.createElement("tr");
    const cells = [`#${p.index}`, pct(p.confidence), p.width_px, p.height_px, p.longest_px];
    if (calibrated) cells.push(p.longest_um);
    cells.forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = v;
      if (i === 5) td.className = "um-col";
      tr.append(td);
    });
    rows.append(tr);
  }

  $("toggle-wrap").hidden = false;
  $("download").hidden = false;
  $("csv").hidden = d.count === 0;
}

// ---------- viewer actions ----------
$("toggle").addEventListener("change", (e) => {
  if (!current) return;
  showImage(e.target.checked ? resultUrl : originalUrl,
    e.target.checked ? `Detection result: ${current.count} particles marked` : "Original image without markings");
});

$("download").addEventListener("click", () => {
  if (!resultUrl) return;
  const a = document.createElement("a");
  a.href = resultUrl;
  a.download = `detected-${(current.filename || "image").replace(/\.[^.]+$/, "")}.jpg`;
  a.click();
});

$("csv").addEventListener("click", () => {
  if (!current) return;
  const head = ["particle", "confidence", "x1", "y1", "x2", "y2", "width_px", "height_px", "longest_px", "longest_um"];
  const lines = [head.join(",")];
  for (const p of current.particles) {
    lines.push([p.index, p.confidence, p.x1, p.y1, p.x2, p.y2, p.width_px, p.height_px, p.longest_px, p.longest_um ?? ""].join(","));
  }
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `particles-${current.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
